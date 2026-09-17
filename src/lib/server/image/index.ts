import fs from 'node:fs';
import { cleanFileExtension } from '$lib/server/helpers';
import * as helpers from '$lib/helpers';
import { getFileFolder } from '$lib/server/env';
import imghash from 'imghash';
import * as fastColor from 'fast-average-color-node';
import imageSize from 'image-size';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '$lib/server/db'
import libheif from 'libheif-js';
import { readImageMetadata } from './metadata';
import { detectFormat, detectHdr, MIME_BY_FORMAT } from './format';
import { composeGainMapJpeg, resizeGainMapJpeg } from './gainmap';
import { readHeicGainMap, readHeicMetadata } from './heic';
import type { PrismaPromise } from '@prisma/client/runtime/client';

/** A region of an image, as fractions of its full size. */
export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Turn a fractional crop into pixel bounds for sharp, clamped so rounding can never push
 * the region past the edge of the image.
 */
export const toPixelCrop = (crop: CropRect, width: number, height: number) => {
	const left = Math.max(0, Math.min(width - 1, Math.round(crop.x * width)));
	const top = Math.max(0, Math.min(height - 1, Math.round(crop.y * height)));
	return {
		left,
		top,
		width: Math.max(1, Math.min(width - left, Math.round(crop.width * width))),
		height: Math.max(1, Math.min(height - top, Math.round(crop.height * height)))
	};
};

export type Images = {
	original: string;
	full: string; 
	i2048: string;
	i1024: string;
	i768: string;
	i512: string;
	i256: Uint8Array<ArrayBuffer>;
	i128: Uint8Array<ArrayBuffer>;
};

/** Everything lives under a single subfolder so the files root can hold other things later. */
export const getImageFolder = () => `${getFileFolder()}/images`;

const ensureImageFolder = () => fs.mkdirSync(getImageFolder(), { recursive: true });

/**
 * The prebuilt `sharp` binaries ship AVIF (AV1) but not HEIC (HEVC) -- `sharp.format.heif`
 * lists only `.avif` as an input suffix -- so the HEICs every iPhone produces fail to
 * decode. Detect those and hand them to libheif instead, which gives us raw RGBA that
 * sharp is happy to take.
 */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

export const isHeic = (buffer: Buffer): boolean => {
	// ISO-BMFF: [4 bytes size]['ftyp'][4 byte major brand]
	if (buffer.length < 12) return false;
	if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
	return HEIC_BRANDS.includes(buffer.toString('ascii', 8, 12).toLowerCase());
};

const decodeHeic = async (buffer: Buffer): Promise<Buffer> => {
	const decoder = new libheif.HeifDecoder();
	const images = decoder.decode(buffer);
	if (images.length === 0) throw new Error('HEIC contained no images');

	const image = images[0];
	const width = image.get_width();
	const height = image.get_height();

	const raw = await new Promise<Uint8Array>((resolve, reject) => {
		const target = { width, height, data: new Uint8Array(width * height * 4) };
		image.display(target, (result) => {
			if (result === null) reject(new Error('HEIC decode failed'));
			else resolve(result.data);
		});
	});

	// libheif hands back RGBA; re-encode to PNG so the rest of the pipeline sees a normal
	// image buffer it can probe for dimensions and orientation.
	return await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
};

/**
 * Normalize an uploaded buffer into something sharp can read. Only used to generate the
 * derivatives -- the bytes that came off the wire are what gets stored as the original.
 * @param buffer the raw uploaded bytes
 * @returns a buffer sharp can decode
 */
const normalizeInput = async (buffer: Buffer): Promise<Buffer> =>
	isHeic(buffer) ? await decodeHeic(buffer) : buffer;

/**
 * Render the whole of an original as a web-friendly JPEG, ignoring any stored crop.
 *
 * The cropper needs to show the full frame -- its rectangle is measured against the
 * original -- but the stored derivatives are built *from* the crop, so showing one would
 * compound each time somebody reframed. Decoding here also means HEIC works in browsers
 * that cannot read it, which is most of them.
 *
 * @param buffer the original file as stored
 * @param width the longest edge to render
 */
export const renderUncropped = async (buffer: Buffer, width = 1024): Promise<Buffer> =>
	await sharp(await normalizeInput(buffer))
		.rotate()
		.resize({ width, withoutEnlargement: true })
		.jpeg({ quality: 82 })
		.toBuffer();

export const cropImages = async (
	image: ArrayBuffer,
	extension: string,
	id: string,
	crop: CropRect | null = null
): Promise<Images | null> => {
	ensureImageFolder();

	const rawBuffer = helpers.toBuffer(image);
	// Trust the bytes, not the filename: Photos exports JPEGs still called `.HEIC`, and
	// storing that extension makes the serving endpoint mislabel the Content-Type.
	const detected = detectFormat(rawBuffer);
	const ext = detected === 'unknown' ? cleanFileExtension(extension) : detected;

	let imageBuffer: Buffer;
	try {
		imageBuffer = await normalizeInput(rawBuffer);
	} catch (e) {
		console.log('Error decoding image', e);
		return null;
	}

	// `.rotate()` first so the crop is measured against the image the right way up, which is
	// the orientation the person framing it was looking at.
	let initial = sharp(imageBuffer).rotate();
	if (crop !== null) {
		try {
			const meta = await initial.metadata();
			if (meta.width && meta.height) {
				initial = sharp(
					await initial.extract(toPixelCrop(crop, meta.width, meta.height)).toBuffer()
				);
			}
		} catch (e) {
			// A bad crop should cost the framing, not the upload.
			console.log('Could not apply crop, using the full frame', e);
			initial = sharp(imageBuffer).rotate();
		}
	}

	// An Apple HDR photo carries a second, greyscale gain map image that sharp neither reads
	// nor writes, so a plain resize quietly demotes it to SDR. Where we can rebuild that
	// pairing at a smaller size we do, which is what lets the page show HDR without having
	// to download the full original.
	const isHdrSource = detectHdr(rawBuffer, detected);
	const hdrSource = isHdrSource ? rawBuffer : null;

	// A HEIC keeps its gain map as an auxiliary image item rather than a second JPEG, so
	// the MPF reader cannot see it. Pull the pixels out once, up front, and rebuild the
	// pairing ourselves for every derivative.
	const heicGainMap = isHdrSource && detected === 'heic' ? readHeicGainMap(rawBuffer) : null;
	// Both halves of a gain-map pair have to be cropped by the same fractions to stay aligned.
	const cropGainMap = (pipeline: Sharp, width: number, height: number) =>
		crop === null ? pipeline : pipeline.extract(toPixelCrop(crop, width, height));
	// The profile and EXIF live in the HEIC container too, and both are needed for a
	// renderer to actually apply the gain map rather than just carry it.
	const heicMeta = heicGainMap !== null ? readHeicMetadata(rawBuffer) : null;

	/**
	 * Build a derivative that keeps its gain map when the source has one, falling back to
	 * the given SDR encoder otherwise. Every size gets the same treatment, so the interface
	 * shows HDR wherever it shows the photo.
	 *
	 * @param width target width, or null for full resolution
	 * @param sdr encoder used when there is no gain map to preserve
	 * @returns the encoded bytes and the extension they should be stored under
	 */
	const derivative = async (
		width: number | null,
		sdr: () => Promise<Buffer>
	): Promise<{ data: Buffer; ext: 'jpg' | 'avif' }> => {
		// Full size is the archival copy, so it keeps more quality than the derivatives the
		// interface actually loads.
		const quality = width === null ? 88 : 82;

		if (heicGainMap !== null) {
			try {
				// `initial` is the decoded HEIC, so the base resizes like any other image; only
				// the gain map needs rebuilding from the raw plane.
				const scale = heicGainMap.width / (await initial.clone().metadata()).width!;
				const [baseJpeg, gainMapJpeg] = await Promise.all([
					(width === null
						? initial.clone()
						: initial.clone().resize({ width, withoutEnlargement: true })
					).jpeg({ quality }).toBuffer(),
					cropGainMap(
						sharp(heicGainMap.data, {
							raw: { width: heicGainMap.width, height: heicGainMap.height, channels: 1 }
						}),
						heicGainMap.width,
						heicGainMap.height
					)
						.resize({
							width: Math.max(1, Math.round((width ?? heicGainMap.width / scale) * scale)),
							withoutEnlargement: true
						})
						.jpeg({ quality: 65 })
						.toBuffer()
				]);
				return {
					data: composeGainMapJpeg({
						baseJpeg,
						gainMapJpeg,
						exif: heicMeta?.exif,
						icc: heicMeta?.icc
					}),
					ext: 'jpg'
				};
			} catch (e) {
				console.log('HEIC gain map compose failed, falling back to SDR', e);
			}
		}

		if (hdrSource !== null) {
			try {
				const hdr = await resizeGainMapJpeg(hdrSource, {
					width: width ?? Number.MAX_SAFE_INTEGER,
					quality,
					crop
				});
				if (hdr !== null) return { data: hdr, ext: 'jpg' };
			} catch (e) {
				// A malformed gain map should cost us HDR, not the whole upload.
				console.log('Gain map resize failed, falling back to SDR', e);
			}
		}
		return { data: await sdr(), ext: 'avif' };
	};

	/**
	 * Encode an SDR AVIF at a given width.
	 *
	 * `effort: 3` rather than the default 4: measured on a 12MP photo at 2048px, effort 4
	 * takes 1.71s and effort 3 takes 0.42s for the same 455KB. The default sits just past a
	 * cliff in libaom's speed/size curve and buys nothing here.
	 */
	const avif = (width: number | null) => async () =>
		await (width === null
			? initial.clone()
			: initial.clone().resize({ width, withoutEnlargement: true })
		).avif({ effort: 3 }).toBuffer();

	const promiseList: Promise<void>[] = [];
	const ret: Images = { } as Images;

	promiseList.push(new Promise<void>(async (resolve, reject) => {
		try {
			// The bytes exactly as uploaded. Re-encoding a HEIC to PNG here turned a 6.5MB
			// photo into a 39MB "original" that was not actually the original.
			const name = `${id}-original.${ext}`;
			fs.writeFileSync(`${getImageFolder()}/${name}`, rawBuffer);
			ret.original = name;
		} catch (e) { reject(e) }
		resolve()
	}));
	promiseList.push(new Promise<void>(async (resolve, reject) => { 
		try {
			// Full resolution stays JPEG. Encoding AVIF at 12MP costs ~8s per photo against
			// ~0.2s for JPEG, which is most of an upload's wall time.
			const out = await derivative(null, async () =>
				await initial.clone().jpeg({ quality: 88 }).toBuffer()
			);
			// Full size is JPEG either way: AVIF at 12MP costs ~8s per photo against ~0.2s.
			const name = `${id}-full.${out.ext === 'avif' ? 'jpg' : out.ext}`;
			fs.writeFileSync(`${getImageFolder()}/${name}`, out.data);
			ret.full = name;
		} catch (e) { reject(e) }
		resolve()
	}));
	promiseList.push(new Promise<void>(async (resolve, reject) => { 
		try {
			// What the photo dialog reaches for on a large, high-density display, where 1024
			// visibly upscales.
			const out = await derivative(2048, avif(2048));
			const name = `${id}-2048.${out.ext}`;
			fs.writeFileSync(`${getImageFolder()}/${name}`, out.data);
			ret.i2048 = name;
		} catch (e) { reject(e) }
		resolve()
	}));
	promiseList.push(new Promise<void>(async (resolve, reject) => { 
		try {
			// The 2x step for the photo dialog on ordinary displays.
			const out = await derivative(1024, avif(1024));
			const name = `${id}-1024.${out.ext}`;
			fs.writeFileSync(`${getImageFolder()}/${name}`, out.data);
			ret.i1024 = name;
		} catch (e) { reject(e) }
		resolve()
	}));
	promiseList.push(new Promise<void>(async (resolve, reject) => { 
		try {
			// The size the photo dialog shows. Kept as a gain-map JPEG for HDR sources so the
			// dialog never has to fall back to the multi-megabyte original.
			const out = await derivative(768, avif(768));
			const name = `${id}-768.${out.ext}`;
			fs.writeFileSync(`${getImageFolder()}/${name}`, out.data);
			ret.i768 = name;
		} catch (e) { reject(e) }
		resolve()
	}));
	promiseList.push(new Promise<void>(async (resolve, reject) => { 
		try {
			const out = await derivative(512, avif(512));
			const name = `${id}-512.${out.ext}`;
			fs.writeFileSync(`${getImageFolder()}/${name}`, out.data);
			ret.i512 = name;
		} catch (e) { reject(e) }
		resolve()
	}));
	promiseList.push(new Promise<void>(async (resolve, reject) => { 
		try {
			ret.i256 = (await derivative(256, avif(256))).data as Uint8Array<ArrayBuffer>;
		} catch (e) { reject(e) }
		resolve()
	}));
	promiseList.push(new Promise<void>(async (resolve, reject) => { 
		try {
			ret.i128 = (await derivative(128, avif(128))).data as Uint8Array<ArrayBuffer>;
		} catch (e) { reject(e) }
		resolve()
	}));

	try {
		const p = await Promise.allSettled(promiseList);
		for (const res of p) {
			if (res.status === 'rejected') {
				console.log('Error cropping images', res.reason);
				return null
			}
		}
	} catch(e) {
		console.log('Error cropping images', e);
		return null;
	}

	return ret;
};


type UploadImageResult = uploadSuccess | uploadFail;

interface uploadSuccess {
	success: true,
	id: string,
	/**
	 * Whether `date` came from the photo's own EXIF rather than the caller's fallback.
	 * Filing by capture date is only honest when this is true.
	 */
	datedFromExif: boolean
}

interface uploadFail {
	success: false,
	message: string,
	/** Set when `checkDuplicate` vetoed the upload. Nothing was stored. */
	duplicate?: unknown,
	/**
	 * A `data:` thumbnail of the rejected photo.
	 *
	 * The client cannot make its own: a HEIC straight off a phone has no browser-renderable
	 * form, so an `<img>` pointed at the local file simply fails. By this point the pipeline
	 * has already decoded it, so the small derivative is the one preview that always works.
	 */
	preview?: string
}

export interface UploadImageOptions {
	/** The user the image is filed under. Required -- `Image.uploadedBy` is not optional. */
	userId: string;
	/** The month bucket the image belongs to, if it is being filed straight away. */
	monthId?: string | null;
	/**
	 * Fallback capture time in unix seconds, used only when the file carries no EXIF date.
	 * The date baked into the photo always wins over this.
	 */
	date?: number;
	/** Position within the month. */
	sort?: number;
	caption?: string | null;
	/** Region of the image to keep, as fractions. Null keeps the whole frame. */
	crop?: CropRect | null;
	/** The max upload size, in MB. */
	maxMB?: number;
	/**
	 * Veto, called once the perceptual hash is known and before anything is committed.
	 *
	 * This is the only point where a duplicate can be caught without storing the photo: the
	 * hash is taken from the finished full-size render, so it does not exist any earlier.
	 * Returning a reason abandons the upload -- the derivatives written a moment ago are
	 * removed and no row is ever created.
	 */
	checkDuplicate?: (hash: string) => Promise<unknown | null>;
}

/**
 * Process images as the result of an image upload
 * @param image the image object, a string or file
 * @param extension the file extension of the upload
 * @param options who the image belongs to and where it should be filed
 * @returns the results if the image upload process
 */
export const uploadImage = async (
	image: string | File,
	extension: string,
	options: UploadImageOptions
): Promise<UploadImageResult> => {
	const maxMB = options.maxMB ?? 10;
	let arrayBuf: ArrayBuffer | null = null;
	let type = '';

	if (typeof image === 'string') {
		const res = await fetch(image);
		if (res.ok !== true) return { success: false, message: 'Could not load image from provided URL'};
		const contentLength = parseInt(res.headers.get('content-length') ?? '*');
		if (isNaN(contentLength)) {
			console.log('ERROR: Image did not provided a \'content-length\' header, so we don\'t know how big it is. Can\'t download.');
			return { success: false, message: 'Unknown image size. See logs.'};
		}
		const t = res.headers.get('content-type');
		if (t === null) {
			console.log('ERROR: Image did not provided a \'content-type\' header, so we don\'t know what kind of file it is. Can\'t download.');
			return { success: false, message: 'Unknown file type. See logs.'};
		}
		type = t;
		if (contentLength / 1000000 > maxMB) return { success: false, message: 'Image too large'};
		arrayBuf = await res.arrayBuffer();
		if (arrayBuf.byteLength / 1000000 > maxMB) return { success: false, message: 'Image too large'};
	} else if (image instanceof File) {
		// Check image size
		if (image.size / 1000000 > maxMB) return { success: false, message: 'Image too large'};
		arrayBuf = await image.arrayBuffer();
		type = image.type;
	} else {
		return { success: false, message: 'Unsupported file type'};
	}

	const id = uuidv4();
	let exifDate: number | null = null;

	try {
		// Read EXIF off the uploaded bytes before anything re-encodes them -- the
		// derivatives drop it, and for HEIC there is no decoded image to read it from.
		const rawBuffer = helpers.toBuffer(arrayBuf);
		const meta = await readImageMetadata(rawBuffer);
		exifDate = meta.date;
		const format = detectFormat(rawBuffer);
		const hdr = detectHdr(rawBuffer, format);

		const images = await cropImages(arrayBuf, extension, id, options.crop ?? null);
		if (images === null) return { success: false, message: 'Unsupported image' };

		// Measure the full-size JPEG, not the original: it is always a format imghash and
		// fast-average-color can read (the original may be HEIC, which they cannot), and it
		// has already had EXIF orientation applied, so width/height are the right way round.
		const fullPath = `${getImageFolder()}/${images.full}`;
		const hash = await imghash.hash(fullPath);

		// Before the row exists, so a rejected duplicate leaves nothing behind. The files were
		// written on the way to computing the hash, so they have to be swept by hand -- there
		// is no image record for `deleteImages` to work from.
		if (options.checkDuplicate !== undefined) {
			const duplicate = await options.checkDuplicate(hash);
			if (duplicate !== null) {
				for (const name of [images.original, images.full, images.i2048, images.i1024, images.i768, images.i512]) {
					if (typeof name !== 'string') continue;
					try {
						fs.unlinkSync(`${getImageFolder()}/${name}`);
					} catch (e) {
						// Already gone, or never written for this size.
					}
				}
				// Built from the in-memory derivative rather than the original bytes, and sniffed
				// rather than assumed -- the small sizes are AVIF for ordinary photos but JPEG
				// for gain-map ones.
				const preview = `data:${MIME_BY_FORMAT[detectFormat(images.i256)]};base64,${Buffer.from(images.i256).toString('base64')}`;
				return { success: false, message: 'Already in the yearbook', duplicate, preview };
			}
		}
		const colors = await fastColor.getAverageColor(fullPath, { ignoredColor: [255, 255, 255, 255] });
		const size = imageSize(fs.readFileSync(fullPath));
		// Store the image
		await prisma.image.create({
			data: {
				id: id,
				originalExtension: format === 'unknown' ? cleanFileExtension(extension) : format,
				hash: hash,
				rgb: colors.rgb,
				rgba: colors.rgba,
				hex: colors.hex,
				hexa: colors.hexa,
				isDark: colors.isDark,
				isLight: colors.isLight,
				width: size.width,
				height: size.height,
				aspectRatio: size.width === 0 || isNaN(size.width) || size.height === 0 || isNaN(size.height) ? -1 : size.width / size.height,
				// True when the file carries a gain map -- an SDR base plus the data needed to
				// lift it on an HDR display. The derivatives below are all SDR; the original
				// is what preserves this.
				isHDR: hdr,
				// The camera's own timestamp beats the browser's file mtime, which is only a
				// stand-in and is lost the moment a photo is re-saved or downloaded.
				date: meta.date ?? options.date ?? Math.floor(Date.now() / 1000),
				latitude: meta.latitude,
				longitude: meta.longitude,
				altitude: meta.altitude,
				make: meta.make,
				model: meta.model,
				lens: meta.lens,
				exif: meta.raw ?? undefined,
				sort: options.sort ?? 0,
				caption: options.caption ?? null,
				cropX: options.crop?.x ?? null,
				cropY: options.crop?.y ?? null,
				cropWidth: options.crop?.width ?? null,
				cropHeight: options.crop?.height ?? null,
				userId: options.userId,
				monthId: options.monthId ?? null,
				...images
			}
		});

	} catch (e) {
		console.log('Error during image upload', e);
		return { success: false, message: 'Upload failed. See logs.' };
	}
	return { success: true, id, datedFromExif: exifDate !== null };
}

export const deleteImages = async (...ids: string[]): Promise<boolean> => {
	try {
		// Delete the files from the folder
		for (const id of ids) {
			const entry = await prisma.image.findUnique({ where: { id: id } });
			if (entry === null) continue;
			// Every stored name already includes its extension.
			for (const name of [entry.original, entry.full, entry.i2048, entry.i1024, entry.i768, entry.i512]) {
				if (name === null) continue;
				try {
					fs.unlinkSync(`${getImageFolder()}/${name}`);
				} catch (e) {}
			}
		}

		// Create some arrays to hold the inserts and hashes created in the loop
		const deletes: PrismaPromise<any>[] = [];

		// Loop through image
		for (const id of ids) deletes.push(prisma.image.delete({ where: { id: id } }));

		// Execute the prisma transaction that will delete all the
		await prisma.$transaction(deletes)

	} catch (e) {
		console.log('Error during clearHangingImages', e);
		return false;
	}
	return true;
}
