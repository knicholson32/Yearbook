/**
 * Conversion of stored originals into the export's target format.
 *
 * The target is deliberately boring: baseline (sequential) JPEG, 8 bits per channel, three
 * channels of sRGB, at the original's own pixel dimensions, with no gain map. That is the
 * format a print shop or a layout tool will accept without argument, which is the whole
 * point of the export.
 *
 * Everything starts from the original file rather than a derivative. The derivatives are
 * AVIF, several are smaller than the source, and the HDR ones carry a gain map -- none of
 * which is what we want here.
 */

import sharp from 'sharp';
import type { Metadata } from 'sharp';
import libheif from 'libheif-js';
import { detectFormat, detectHdr } from '$lib/server/image/format';
import { isHeic } from '$lib/server/image';

/** Quality for re-encodes. High enough that the conversion is not the weak link. */
const JPEG_QUALITY = 95;

export interface ConversionResult {
	data: Buffer;
	/** True when the original was already compliant and was copied through untouched. */
	passthrough: boolean;
	/** Why a re-encode was needed, for the job log. Empty on passthrough. */
	reason: string;
}

/**
 * Decide whether a stored original can be exported as-is.
 *
 * Re-encoding is lossy, so a file that already meets the spec should be copied byte for
 * byte -- it is both faster and better. Everything here is a reason it cannot be.
 *
 * @param buffer the original file as stored
 * @returns null when the file is already compliant, otherwise the reason it is not
 */
export const nonCompliantReason = async (buffer: Buffer): Promise<string | null> => {
	if (detectFormat(buffer) !== 'jpg') return 'not JPEG';

	// A gain map rides along as a second MPF image, so the file is still "a JPEG" while
	// carrying exactly the HDR data the export is supposed to drop.
	if (detectHdr(buffer, 'jpg')) return 'HDR gain map';

	let meta: Metadata;
	try {
		meta = await sharp(buffer).metadata();
	} catch (e) {
		return 'unreadable header';
	}

	// Progressive JPEG is not baseline: it uses SOF2, and some print workflows reject it.
	if (meta.isProgressive === true) return 'progressive';
	// CMYK and greyscale JPEGs are valid but are not 3-channel RGB.
	if (meta.channels !== 3) return `${meta.channels ?? '?'} channels`;
	if (meta.space !== 'srgb') return `${meta.space ?? 'unknown'} colourspace`;
	// 12-bit JPEG exists and is not what we promised.
	if (meta.depth !== undefined && meta.depth !== 'uchar') return `${meta.depth} depth`;
	// An embedded profile means the pixels are not plain sRGB, whatever the header says.
	if (meta.icc !== undefined) return 'embedded ICC profile';
	// Anything that needs rotating is not going to survive a byte copy looking upright.
	if (meta.orientation !== undefined && meta.orientation > 1) return `orientation ${meta.orientation}`;

	return null;
};

/**
 * Decode to something sharp can read.
 *
 * Mirrors the upload pipeline: the prebuilt sharp binaries carry AVIF but not HEIC, so
 * iPhone originals have to go through libheif first.
 */
const decode = async (buffer: Buffer): Promise<Buffer> => {
	if (!isHeic(buffer)) return buffer;

	const decoder = new libheif.HeifDecoder();
	const images = decoder.decode(buffer);
	if (images.length === 0) throw new Error('HEIC contained no images');

	// The primary image only. A HDR HEIC also holds the gain map as an auxiliary item, and
	// leaving it behind here is exactly the conversion we want.
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

	return await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
};

/**
 * Convert one stored original into an export-ready JPEG.
 *
 * @param buffer the original file as stored
 * @returns the JPEG bytes, plus whether any re-encode was needed
 */
export const toExportJpeg = async (buffer: Buffer): Promise<ConversionResult> => {
	const reason = await nonCompliantReason(buffer);
	if (reason === null) return { data: buffer, passthrough: true, reason: '' };

	const pipeline = sharp(await decode(buffer))
		// Bake in the EXIF orientation. Metadata is dropped below, so a file that relied on
		// the tag would otherwise come out of the export lying on its side.
		.rotate()
		// Alpha cannot survive in a 3-channel JPEG; compositing explicitly beats letting the
		// encoder decide, which tends to give black edges.
		.flatten({ background: '#ffffff' })
		// Convert the pixels rather than merely relabelling them. Originals off an iPhone are
		// Display P3, and dropping that profile without a conversion leaves the numbers
		// describing the wrong colours -- saturated reds visibly shift.
		.toColourspace('srgb');

	const data = await pipeline
		.jpeg({
			quality: JPEG_QUALITY,
			// The spec: SOF0 sequential, not SOF2 progressive.
			progressive: false,
			// At this quality, chroma subsampling is the dominant artefact. Full resolution
			// chroma costs some size and keeps fine coloured detail intact.
			chromaSubsampling: '4:4:4',
			mozjpeg: false
		})
		// No ICC, no EXIF, no XMP. sharp strips metadata by default; this is here to say it
		// is deliberate. Dropping XMP is what guarantees no Apple gain-map marker survives,
		// and with the pixels now genuinely sRGB an absent profile is the correct statement.
		.toBuffer();

	return { data, passthrough: false, reason };
};

/**
 * Verify an export candidate really is what was promised. Used by the tests rather than on
 * every image in a run.
 */
export const describeJpeg = async (buffer: Buffer) => {
	const meta = await sharp(buffer).metadata();
	return {
		format: detectFormat(buffer),
		hdr: detectHdr(buffer, detectFormat(buffer)),
		progressive: meta.isProgressive === true,
		channels: meta.channels,
		space: meta.space,
		depth: meta.depth,
		icc: meta.icc !== undefined,
		width: meta.width,
		height: meta.height
	};
};
