import exifr from 'exifr';

export interface ImageMetadata {
	/** Capture time in unix seconds, or null if the file carries no date. */
	date: number | null;
	latitude: number | null;
	longitude: number | null;
	/** Metres above sea level. Negative below. */
	altitude: number | null;
	make: string | null;
	model: string | null;
	lens: string | null;
	/** Every other readable tag, sanitised down to JSON-safe primitives. */
	raw: Record<string, string | number | boolean> | null;
}

const EMPTY: ImageMetadata = {
	date: null,
	latitude: null,
	longitude: null,
	altitude: null,
	make: null,
	model: null,
	lens: null,
	raw: null
};

/**
 * EXIF timestamps are naive local time -- "2024:07:04 14:23:11" with no zone. Parsing that
 * into a Date makes the result depend on the server's timezone, which can shift a photo
 * into the neighbouring month. Read the wall-clock fields the camera wrote and pin them to
 * UTC instead, so a photo taken at 11pm on the 31st stays on the 31st wherever this runs.
 */
const parseExifDate = (value: unknown): number | null => {
	if (typeof value !== 'string') return null;
	const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
	if (m === null) return null;
	const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
	const ms = Date.UTC(y, mo - 1, d, h, mi, s);
	if (Number.isNaN(ms)) return null;
	// Cameras with a dead clock love 1970 and 1980; treat those as "no date".
	const year = new Date(ms).getUTCFullYear();
	if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
	return Math.floor(ms / 1000);
};

const finite = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * exifr hands back Uint8Arrays, nested objects and the occasional multi-kilobyte binary
 * blob (maker notes, thumbnails, colour profiles). Keep the plain primitives so the stored
 * JSON stays small and actually readable.
 */
const sanitize = (tags: Record<string, unknown>): Record<string, string | number | boolean> | null => {
	const out: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(tags)) {
		if (typeof value === 'number') {
			if (Number.isFinite(value)) out[key] = value;
		} else if (typeof value === 'boolean') {
			out[key] = value;
		} else if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed !== '' && trimmed.length <= 512) out[key] = trimmed;
		}
	}
	return Object.keys(out).length === 0 ? null : out;
};

const text = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
};

/**
 * Read capture date, GPS and camera fields out of an uploaded file.
 *
 * Works straight off the container bytes, so HEIC is covered without decoding the image --
 * which matters here, because the bundled sharp cannot decode HEIC at all.
 *
 * @param buffer the bytes exactly as uploaded
 * @returns whatever could be read; every field is null when the file carries no EXIF
 */
export const readImageMetadata = async (buffer: Buffer): Promise<ImageMetadata> => {
	try {
		// `reviveValues: false` keeps dates as their raw strings for parseExifDate above.
		const tags = await exifr.parse(buffer, {
			tiff: true,
			exif: true,
			gps: true,
			reviveValues: false,
			translateValues: false
		});
		if (tags === undefined || tags === null) return EMPTY;

		// GPS coordinates need the ref tags applied, which exifr only does on its own
		// `.gps()` path, so ask for those separately rather than re-deriving the sign here.
		let latitude: number | null = null;
		let longitude: number | null = null;
		try {
			const gps = await exifr.gps(buffer);
			latitude = finite(gps?.latitude);
			longitude = finite(gps?.longitude);
		} catch (e) { /* no GPS block; leave them null */ }

		const rawAltitude = finite(tags.GPSAltitude);
		// GPSAltitudeRef: 0 = above sea level, 1 = below.
		const belowSeaLevel = Number(tags.GPSAltitudeRef?.[0] ?? tags.GPSAltitudeRef ?? 0) === 1;

		return {
			date: parseExifDate(tags.DateTimeOriginal) ?? parseExifDate(tags.CreateDate) ?? parseExifDate(tags.ModifyDate),
			latitude,
			longitude,
			altitude: rawAltitude === null ? null : belowSeaLevel ? -rawAltitude : rawAltitude,
			make: text(tags.Make),
			model: text(tags.Model),
			lens: text(tags.LensModel),
			raw: sanitize(tags)
		};
	} catch (e) {
		// A file with no EXIF at all is normal, not an error worth failing an upload over.
		return EMPTY;
	}
};
