/**
 * Resizing Apple gain-map (HDR) JPEGs.
 *
 * An Apple HDR photo is two JPEGs in one file: an SDR base image, and a greyscale gain map
 * that a capable display uses to lift it. They are bound together by an MPF (Multi-Picture
 * Format) APP2 segment listing both, and the HDR declaration lives in the gain map's own
 * XMP rather than the primary's.
 *
 * sharp decodes only the base image and drops everything else, so a plain resize silently
 * turns an HDR photo into an SDR one. This module resizes both halves and reassembles the
 * container, so smaller derivatives stay HDR instead of forcing the page to load the full
 * original.
 *
 * The result degrades gracefully: any viewer that does not understand gain maps just sees
 * the SDR base image, exactly as it would with the original.
 */
import sharp from 'sharp';
import type { Sharp } from 'sharp';

const SOI = 0xd8;
const APP1 = 0xe1;
const APP2 = 0xe2;
const SOS = 0xda;

const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';
const EXIF_ID = 'Exif\0\0';
const MPF_ID = 'MPF\0';
const ICC_ID = 'ICC_PROFILE\0';

/**
 * The XMP Apple attaches to a gain map. It is what marks the second image as an HDR gain
 * map rather than just a thumbnail, so a map recovered from a HEIC needs it synthesised.
 */
export const APPLE_GAIN_MAP_XMP =
	'<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">' +
	'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
	'<rdf:Description rdf:about="" ' +
	'xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/" ' +
	'xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/">' +
	'<apdi:AuxiliaryImageType>urn:com:apple:photo:2020:aux:hdrgainmap</apdi:AuxiliaryImageType>' +
	'<apdi:StoredFormat>1278226488</apdi:StoredFormat>' +
	'<apdi:NativeFormat>1278226488</apdi:NativeFormat>' +
	'<HDRGainMap:HDRGainMapVersion>65536</HDRGainMap:HDRGainMapVersion>' +
	'</rdf:Description></rdf:RDF></x:xmpmeta>';

export interface JpegSegment {
	marker: number;
	/** Payload after the 2-byte length field. */
	payload: Buffer;
}

/**
 * Split a JPEG into its marker segments, stopping at the start of scan data.
 * @returns the segments before SOS, and the remaining bytes from SOS onward
 */
export const splitJpeg = (buffer: Buffer): { segments: JpegSegment[]; rest: Buffer } => {
	const segments: JpegSegment[] = [];
	let i = 2; // skip SOI

	while (i + 3 < buffer.length) {
		if (buffer[i] !== 0xff) break;
		const marker = buffer[i + 1];
		if (marker === SOS) break;
		const length = buffer.readUInt16BE(i + 2);
		segments.push({ marker, payload: buffer.subarray(i + 4, i + 2 + length) });
		i += 2 + length;
	}

	return { segments, rest: buffer.subarray(i) };
};

const segmentStartsWith = (segment: JpegSegment, id: string) =>
	segment.payload.subarray(0, id.length).toString('latin1') === id;

/** Find the first APP1 payload matching an identifier (EXIF or XMP). */
const findApp1 = (segments: JpegSegment[], id: string): Buffer | null =>
	segments.find((s) => s.marker === APP1 && segmentStartsWith(s, id))?.payload ?? null;

/** Reassemble a JPEG from segments plus scan data. */
const joinJpeg = (segments: JpegSegment[], rest: Buffer): Buffer => {
	const parts: Buffer[] = [Buffer.from([0xff, SOI])];
	for (const s of segments) {
		const header = Buffer.alloc(4);
		header[0] = 0xff;
		header[1] = s.marker;
		header.writeUInt16BE(s.payload.length + 2, 2);
		parts.push(header, s.payload);
	}
	parts.push(rest);
	return Buffer.concat(parts);
};

export interface GainMapParts {
	base: Buffer;
	gainMap: Buffer;
	/** The gain map's XMP payload, which carries the Apple HDR declaration. */
	gainMapXmp: Buffer | null;
}

/**
 * Pull the two images out of an Apple MPF JPEG.
 * @param buffer the original file
 * @returns both images, or null when the file is not a two-image MPF JPEG
 */
export const extractGainMap = (buffer: Buffer): GainMapParts | null => {
	const marker = buffer.indexOf(Buffer.from(MPF_ID, 'latin1'));
	if (marker < 0) return null;

	try {
		// Offsets for images after the first are measured from the MP Endian field, which
		// sits immediately after the 'MPF\0' identifier.
		const tiff = marker + MPF_ID.length;
		const bigEndian = buffer.toString('latin1', tiff, tiff + 2) === 'MM';
		const u16 = (o: number) => (bigEndian ? buffer.readUInt16BE(o) : buffer.readUInt16LE(o));
		const u32 = (o: number) => (bigEndian ? buffer.readUInt32BE(o) : buffer.readUInt32LE(o));

		const ifd = tiff + u32(tiff + 4);
		const entries = u16(ifd);

		for (let i = 0; i < entries; i++) {
			const entry = ifd + 2 + i * 12;
			if (u16(entry) !== 0xb002) continue; // MPEntry

			const count = u32(entry + 4);
			if (count < 32) return null; // fewer than two images
			const table = tiff + u32(entry + 8);

			const second = table + 16;
			const size = u32(second + 4);
			const offset = u32(second + 8);
			const start = tiff + offset;
			if (size <= 0 || start + size > buffer.length) return null;

			const gainMap = buffer.subarray(start, start + size);
			if (gainMap[0] !== 0xff || gainMap[1] !== SOI) return null;

			return {
				base: buffer.subarray(0, start),
				gainMap,
				gainMapXmp: findApp1(splitJpeg(gainMap).segments, XMP_ID)
			};
		}
	} catch (e) {
		// Malformed MPF: treat as "no gain map" rather than failing the whole resize.
	}
	return null;
};

/**
 * Build the MPF APP2 payload describing a two-image file.
 * @param primarySize byte length of the base image, including this segment
 * @param gainMapSize byte length of the gain map
 * @param gainMapOffset gain map position, measured from the MP Endian field
 */
const buildMpf = (primarySize: number, gainMapSize: number, gainMapOffset: number): Buffer => {
	// 'MPF\0' + TIFF header (8) + IFD count (2) + 3 entries (36) + next-IFD (4) + 2 entries (32)
	const payload = Buffer.alloc(4 + 8 + 2 + 36 + 4 + 32);
	let o = 0;
	payload.write(MPF_ID, o, 'latin1');
	o += 4;

	const tiff = o;
	payload.write('MM', o, 'latin1');
	o += 2;
	payload.writeUInt16BE(0x002a, o);
	o += 2;
	payload.writeUInt32BE(8, o); // first IFD sits right after the header
	o += 4;

	payload.writeUInt16BE(3, o); // three directory entries
	o += 2;

	// MPFVersion: UNDEFINED[4] = "0100", stored inline
	payload.writeUInt16BE(0xb000, o);
	payload.writeUInt16BE(7, o + 2);
	payload.writeUInt32BE(4, o + 4);
	payload.write('0100', o + 8, 'latin1');
	o += 12;

	// NumberOfImages: LONG = 2
	payload.writeUInt16BE(0xb001, o);
	payload.writeUInt16BE(4, o + 2);
	payload.writeUInt32BE(1, o + 4);
	payload.writeUInt32BE(2, o + 8);
	o += 12;

	// MPEntry: UNDEFINED[32], stored out of line
	const entriesOffset = 8 + 2 + 36 + 4; // from the MP Endian field
	payload.writeUInt16BE(0xb002, o);
	payload.writeUInt16BE(7, o + 2);
	payload.writeUInt32BE(32, o + 4);
	payload.writeUInt32BE(entriesOffset, o + 8);
	o += 12;

	payload.writeUInt32BE(0, o); // no next IFD
	o += 4;

	// Entry 0: the primary image. Attribute 0x00030000 marks a Baseline MP Primary Image,
	// and its offset is always zero by definition.
	payload.writeUInt32BE(0x00030000, o);
	payload.writeUInt32BE(primarySize, o + 4);
	payload.writeUInt32BE(0, o + 8);
	payload.writeUInt16BE(0, o + 12);
	payload.writeUInt16BE(0, o + 14);
	o += 16;

	// Entry 1: the gain map, matching how Apple tags it (no type bits set).
	payload.writeUInt32BE(0x00000000, o);
	payload.writeUInt32BE(gainMapSize, o + 4);
	payload.writeUInt32BE(gainMapOffset, o + 8);
	payload.writeUInt16BE(0, o + 12);
	payload.writeUInt16BE(0, o + 14);

	if (tiff !== 4) throw new Error('MPF header layout changed');
	return payload;
};

export interface ResizeOptions {
	width: number;
	/** JPEG quality for the base image. */
	quality?: number;
	/**
	 * JPEG quality for the gain map. Defaults lower than the base: a gain map is a smooth,
	 * low-frequency greyscale, so it survives hard compression, and at these sizes it is
	 * the base image that dominates the byte count anyway.
	 */
	gainMapQuality?: number;
	/** Segments to carry over onto the resized base, e.g. EXIF and the primary's XMP. */
	keepFrom?: Buffer;
	/** Region to keep, as fractions of the full image. Applied to both halves alike. */
	crop?: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Resize an Apple gain-map JPEG, keeping it HDR.
 *
 * @param original the full-size file as uploaded
 * @param options target width and JPEG quality
 * @returns the resized two-image JPEG, or null if the input has no usable gain map
 */
export const resizeGainMapJpeg = async (
	original: Buffer,
	options: ResizeOptions
): Promise<Buffer | null> => {
	const parts = extractGainMap(original);
	if (parts === null || parts.gainMapXmp === null) return null;

	const quality = options.quality ?? 82;
	const gainMapQuality = options.gainMapQuality ?? 65;

	const baseMeta = await sharp(parts.base).metadata();
	const gainMeta = await sharp(parts.gainMap).metadata();
	if (!baseMeta.width || !gainMeta.width) return null;

	// Never enlarge: a gain map upscaled past its source adds bytes and no detail.
	const targetWidth = Math.min(options.width, baseMeta.width);

	// Keep the gain map at the same fraction of the base it started at. Apple ships it at
	// half resolution; matching that ratio keeps the pairing the renderer expects.
	const ratio = gainMeta.width / baseMeta.width;
	const gainWidth = Math.max(1, Math.round(targetWidth * ratio));

	// The base and the gain map must be cropped by the same fractions or they stop lining up.
	const extract = (pipeline: Sharp, w: number, h: number) => {
		const c = options.crop;
		if (!c) return pipeline;
		const left = Math.max(0, Math.min(w - 1, Math.round(c.x * w)));
		const top = Math.max(0, Math.min(h - 1, Math.round(c.y * h)));
		return pipeline.extract({
			left,
			top,
			width: Math.max(1, Math.min(w - left, Math.round(c.width * w))),
			height: Math.max(1, Math.min(h - top, Math.round(c.height * h)))
		});
	};

	const [resizedBase, resizedGain] = await Promise.all([
		// keepIccProfile matters for more than the tag: without it sharp converts the pixels
		// to sRGB on the way out, so re-attaching the original Display P3 profile afterwards
		// would describe the data wrongly -- oversaturated, and no HDR.
		extract(sharp(parts.base), baseMeta.width, baseMeta.height)
			.resize({ width: targetWidth, withoutEnlargement: true })
			.keepIccProfile()
			.jpeg({ quality })
			.toBuffer(),
		extract(sharp(parts.gainMap), gainMeta.width, gainMeta.height)
			.resize({ width: gainWidth, withoutEnlargement: true })
			.toColourspace('b-w')
			.jpeg({ quality: gainMapQuality })
			.toBuffer()
	]);

	return composeGainMapJpeg({
		baseJpeg: resizedBase,
		gainMapJpeg: resizedGain,
		gainMapXmp: parts.gainMapXmp,
		carryFrom: options.keepFrom ?? parts.base
	});
};

/**
 * Wrap a raw ICC profile into APP2 segments.
 *
 * A JPEG marker segment tops out at 65533 bytes, so a large profile is split across
 * numbered chunks -- Apple's Display P3 profile is ~30KB and fits in one, but the
 * chunking is cheap to get right and expensive to discover missing later.
 */
const buildIccSegments = (icc: Buffer): JpegSegment[] => {
	// 65533 payload cap, minus the 2-byte length, the 12-byte identifier and 2 counters.
	const MAX = 65517;
	const total = Math.max(1, Math.ceil(icc.length / MAX));
	const segments: JpegSegment[] = [];
	for (let i = 0; i < total; i++) {
		const chunk = icc.subarray(i * MAX, (i + 1) * MAX);
		const payload = Buffer.alloc(ICC_ID.length + 2 + chunk.length);
		payload.write(ICC_ID, 0, 'latin1');
		payload[ICC_ID.length] = i + 1;
		payload[ICC_ID.length + 1] = total;
		chunk.copy(payload, ICC_ID.length + 2);
		segments.push({ marker: APP2, payload });
	}
	return segments;
};

export interface ComposeOptions {
	/** The SDR base image, already at its final size. */
	baseJpeg: Buffer;
	/** The greyscale gain map, already at its final size. */
	gainMapJpeg: Buffer;
	/** XMP marking the second image as a gain map. Defaults to Apple's. */
	gainMapXmp?: Buffer | null;
	/** A JPEG whose EXIF, XMP and colour profile should be copied onto the base. */
	carryFrom?: Buffer | null;
	/** Raw TIFF block to write as APP1 Exif, when not copying from a JPEG. */
	exif?: Buffer | null;
	/** Raw ICC profile to write as APP2 ICC_PROFILE, when not copying from a JPEG. */
	icc?: Buffer | null;
}

/**
 * Bind a base image and a gain map into one MPF JPEG.
 *
 * @returns the combined file, which viewers without gain-map support read as plain SDR
 */
export const composeGainMapJpeg = (options: ComposeOptions): Buffer => {
	const xmp = options.gainMapXmp ?? Buffer.from(XMP_ID + APPLE_GAIN_MAP_XMP, 'latin1');

	// Re-attach the gain map's XMP; it is what identifies this as an Apple HDR gain map.
	const gainSplit = splitJpeg(options.gainMapJpeg);
	const gainWithXmp = joinJpeg(
		[{ marker: APP1, payload: xmp }, ...gainSplit.segments.filter((s) => !(s.marker === APP1 && segmentStartsWith(s, XMP_ID)))],
		gainSplit.rest
	);

	// Carry EXIF, XMP and the colour profile onto the new base. All three matter: the
	// maker notes inside EXIF hold Apple's HDR headroom, and the Display P3 profile is what
	// tells a renderer the base is wide gamut. A gain map without them is data with no
	// instruction attached, which is why a stripped derivative reads as plain SDR.
	const carried: JpegSegment[] = [];
	const iccSegments: JpegSegment[] = [];

	if (options.carryFrom) {
		const source = splitJpeg(options.carryFrom).segments;
		const exif = findApp1(source, EXIF_ID);
		const primaryXmp = findApp1(source, XMP_ID);
		if (exif !== null) carried.push({ marker: APP1, payload: exif });
		if (primaryXmp !== null) carried.push({ marker: APP1, payload: primaryXmp });
		// Copy the profile's own chunking rather than reassembling it.
		for (const s of source) {
			if (s.marker === APP2 && segmentStartsWith(s, ICC_ID)) iccSegments.push(s);
		}
	}

	if (options.exif && carried.every((s) => !segmentStartsWith(s, EXIF_ID))) {
		carried.unshift({ marker: APP1, payload: Buffer.concat([Buffer.from(EXIF_ID, 'latin1'), options.exif]) });
	}
	if (options.icc && iccSegments.length === 0) {
		iccSegments.push(...buildIccSegments(options.icc));
	}

	const baseSplit = splitJpeg(options.baseJpeg);
	// Drop the metadata we are replacing so it is not duplicated -- but never the profile
	// sharp embedded, which describes the pixels it actually wrote.
	const kept = baseSplit.segments.filter(
		(s) => !(s.marker === APP1 && (segmentStartsWith(s, EXIF_ID) || segmentStartsWith(s, XMP_ID)))
	);
	const baseHasIcc = kept.some((s) => s.marker === APP2 && segmentStartsWith(s, ICC_ID));

	// Segment order mirrors what the camera wrote: Exif, XMP, MPF, then the profile.
	// The MPF payload is a fixed size, so assemble once with placeholder offsets and then
	// measure the real ones -- adding the segment cannot shift anything after it.
	const placeholder = buildMpf(0, 0, 0);
	const withMpf = joinJpeg(
		[
			...carried,
			{ marker: APP2, payload: placeholder },
			...(baseHasIcc ? [] : iccSegments),
			...kept
		],
		baseSplit.rest
	);

	const mpfAt = withMpf.indexOf(Buffer.from(MPF_ID, 'latin1'));
	const endianAt = mpfAt + MPF_ID.length;
	const primarySize = withMpf.length;
	buildMpf(primarySize, gainWithXmp.length, primarySize - endianAt).copy(withMpf, mpfAt);

	return Buffer.concat([withMpf, gainWithXmp]);
};
