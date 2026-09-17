/**
 * Image format detection and HDR probing.
 *
 * Filenames lie. Exporting from Photos routinely produces a JPEG still called `.HEIC`,
 * and serving that as `image/heic` makes every browser refuse to render it -- so the
 * stored extension and the Content-Type both come from the bytes, never the name.
 */

export type ImageFormat = 'jpg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic' | 'tiff' | 'unknown';

export const MIME_BY_FORMAT: Record<ImageFormat, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	tiff: 'image/tiff',
	unknown: 'application/octet-stream'
};

const AVIF_BRANDS = ['avif', 'avis'];

/**
 * Prisma hands `Bytes` columns back as plain `Uint8Array`, whose `toString()` ignores the
 * encoding and range arguments entirely and returns comma-separated digits. Every string
 * comparison below would silently fail on one, so normalise first rather than trusting a
 * cast at the call site.
 */
const asBuffer = (bytes: Uint8Array): Buffer =>
	Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * Identify an image from its magic bytes.
 * @param bytes the image data
 */
export const detectFormat = (bytes: Uint8Array): ImageFormat => {
	const buffer = asBuffer(bytes);
	if (buffer.length < 12) return 'unknown';

	if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
	if (buffer.toString('ascii', 1, 4) === 'PNG') return 'png';
	if (buffer.toString('ascii', 0, 3) === 'GIF') return 'gif';
	if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
		return 'webp';
	}

	// ISO-BMFF: [size]['ftyp'][major brand]. AVIF and HEIC share the container.
	if (buffer.toString('ascii', 4, 8) === 'ftyp') {
		const brand = buffer.toString('ascii', 8, 12).toLowerCase();
		return AVIF_BRANDS.includes(brand) ? 'avif' : 'heic';
	}

	const tiffMagic = buffer.toString('hex', 0, 4);
	if (tiffMagic === '49492a00' || tiffMagic === '4d4d002a') return 'tiff';

	return 'unknown';
};

/** Formats every current browser can render directly from an `<img>`. */
const WEB_RENDERABLE: ImageFormat[] = ['jpg', 'png', 'gif', 'webp', 'avif'];

export const isWebRenderable = (format: ImageFormat): boolean => WEB_RENDERABLE.includes(format);

/**
 * Count the images an Apple/MPF JPEG declares. A gain-map photo carries two: the SDR base
 * plus the map that lifts it to HDR on a capable display.
 * @returns the declared image count, or 0 when there is no MPF segment
 */
const countMpfImages = (input: Uint8Array): number => {
	const buffer = asBuffer(input);
	const marker = buffer.indexOf(Buffer.from('MPF\0', 'ascii'));
	if (marker < 0) return 0;

	try {
		// A TIFF header sits immediately after the 'MPF\0' identifier.
		const tiff = marker + 4;
		const bigEndian = buffer.toString('ascii', tiff, tiff + 2) === 'MM';
		const u16 = (o: number) => (bigEndian ? buffer.readUInt16BE(o) : buffer.readUInt16LE(o));
		const u32 = (o: number) => (bigEndian ? buffer.readUInt32BE(o) : buffer.readUInt32LE(o));

		const ifd = tiff + u32(tiff + 4);
		const entries = u16(ifd);
		for (let i = 0; i < entries; i++) {
			const entry = ifd + 2 + i * 12;
			if (u16(entry) === 0xb001) return u32(entry + 8); // MPFNumberOfImages
		}
	} catch (e) {
		// A truncated or malformed MPF block just means "we don't know".
	}
	return 0;
};

/** Markers Apple and Google use to tag a gain map, in XMP or the ISO-BMFF item metadata. */
const GAIN_MAP_MARKERS = [
	'hdrgainmap', // Apple, XMP + HEIC aux type
	'HDRGainMap',
	'apple_desktop:HDRGainMap',
	'GainMapVersion', // Google Ultra HDR / ISO 21496-1
	'hdr:GainMap',
	'urn:com:apple:photo:2020:aux:hdrgainmap'
];

/**
 * Decide whether a file carries HDR information we could act on.
 *
 * Detects the gain-map style used by iPhones and Android (an SDR base image plus a map),
 * which is what actually arrives here. Files that are HDR by virtue of a PQ/HLG transfer
 * curve are not detected, because nothing in this pipeline produces or consumes them yet.
 *
 * @param buffer the bytes as uploaded
 * @param format the detected format
 */
export const detectHdr = (bytes: Uint8Array, format: ImageFormat): boolean => {
	const buffer = asBuffer(bytes);
	if (format === 'jpg' && countMpfImages(buffer) >= 2) return true;

	// Search only the header region: gain-map markers live in metadata near the front, and
	// scanning a 10MB body for strings on every upload is wasted work.
	const header = buffer.subarray(0, Math.min(buffer.length, 256 * 1024)).toString('latin1');
	return GAIN_MAP_MARKERS.some((marker) => header.includes(marker));
};
