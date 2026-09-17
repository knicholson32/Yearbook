/**
 * Reading the HDR gain map out of a HEIC.
 *
 * An Apple HEIC keeps its gain map as an *auxiliary image item* inside the ISO-BMFF
 * container, not as a second JPEG the way the MPF format does. libheif's high-level
 * JavaScript wrapper only ever hands back top-level images, so `HeifDecoder.decode()`
 * returns the base picture alone and the gain map is silently lost.
 *
 * The auxiliary-image C API is exported by the WASM build though, so this reaches past the
 * wrapper to call it. Two details make that work:
 *
 *  - The wrapper's handles are Embind objects; the raw pointer the C functions want lives
 *    at `handle.$$.ptr`.
 *  - `heif_error` is a struct returned by value, which in wasm32 becomes a hidden pointer
 *    argument in first position. Hence the `errPtr` leading several calls below.
 */
import libheif from 'libheif-js';

/** Embind enums arrive as objects; the C API wants their numeric value. */
const enumValue = (e: unknown): number =>
	typeof e === 'object' && e !== null && 'value' in e ? (e as { value: number }).value : (e as number);

/** Read a NUL-terminated C string out of the WASM heap. */
const readCString = (lib: any, ptr: number): string => {
	if (!ptr) return '';
	let end = ptr;
	while (lib.HEAPU8[end] !== 0) end++;
	return Buffer.from(lib.HEAPU8.buffer, ptr, end - ptr).toString('latin1');
};

export interface HeicMetadata {
	/** Raw ICC profile bytes, ready to become an APP2 ICC_PROFILE segment. */
	icc: Buffer | null;
	/** TIFF block, ready to become an APP1 Exif segment. */
	exif: Buffer | null;
}

export interface RawGainMap {
	width: number;
	height: number;
	/** Single-channel 8-bit pixels, stride padding already removed. */
	data: Buffer;
}

/**
 * Decode the HDR gain map stored alongside a HEIC's primary image.
 *
 * @param buffer the HEIC file as uploaded
 * @returns the gain map pixels, or null when the file carries no auxiliary gain map
 */
/**
 * Pull the colour profile and EXIF out of a HEIC.
 *
 * Both matter for HDR: the Display P3 profile tells the renderer the base image is wide
 * gamut, and Apple's headroom values live in the maker notes inside EXIF. A gain map
 * without them is data the browser has no instruction to apply.
 *
 * @param buffer the HEIC file as uploaded
 */
export const readHeicMetadata = (buffer: Buffer): HeicMetadata => {
	const lib = libheif as any;
	let context: unknown = null;
	const allocated: number[] = [];
	const alloc = (bytes: number): number => {
		const p = lib._malloc(bytes);
		allocated.push(p);
		return p;
	};

	const empty: HeicMetadata = { icc: null, exif: null };

	try {
		context = lib.heif_context_alloc();
		if (!context) return empty;
		if (enumValue(lib.heif_context_read_from_memory(context, buffer)?.code) !== 0) return empty;

		const handle = lib.heif_js_context_get_primary_image_handle(context)?.$$?.ptr;
		if (!handle) return empty;

		const errPtr = alloc(16);
		let icc: Buffer | null = null;
		let exif: Buffer | null = null;

		const iccSize = lib._heif_image_handle_get_raw_color_profile_size(handle);
		if (iccSize > 0) {
			const out = alloc(iccSize);
			lib._heif_image_handle_get_raw_color_profile(errPtr, handle, out);
			if (lib.HEAP32[errPtr >> 2] === 0) {
				icc = Buffer.from(Buffer.from(lib.HEAPU8.buffer, out, iccSize));
			}
		}

		// Filter 0 returns every metadata block; we want the Exif one.
		const blocks = lib._heif_image_handle_get_number_of_metadata_blocks(handle, 0);
		if (blocks > 0) {
			const idsPtr = alloc(4 * blocks);
			const written = lib._heif_image_handle_get_list_of_metadata_block_IDs(handle, 0, idsPtr, blocks);
			for (let i = 0; i < written; i++) {
				const id = lib.HEAPU32[(idsPtr >> 2) + i];
				if (readCString(lib, lib._heif_image_handle_get_metadata_type(handle, id)) !== 'Exif') continue;

				const size = lib._heif_image_handle_get_metadata_size(handle, id);
				if (size <= 4) continue;
				const out = alloc(size);
				lib._heif_image_handle_get_metadata(errPtr, handle, id, out);
				if (lib.HEAP32[errPtr >> 2] !== 0) continue;

				const block = Buffer.from(Buffer.from(lib.HEAPU8.buffer, out, size));
				// An ISO/IEC 23008-12 Exif block is a 4-byte big-endian offset to the TIFF
				// header, then the payload. JPEG wants the TIFF data on its own.
				const tiffOffset = 4 + block.readUInt32BE(0);
				if (tiffOffset < block.length) exif = block.subarray(tiffOffset);
				break;
			}
		}

		return { icc, exif };
	} catch (e) {
		console.log('Error reading HEIC metadata', e);
		return empty;
	} finally {
		for (const p of allocated) {
			try { (libheif as any)._free(p); } catch (e) { /* nothing useful to do */ }
		}
		if (context) {
			try { (libheif as any).heif_context_free(context); } catch (e) { /* ditto */ }
		}
	}
};

export const readHeicGainMap = (buffer: Buffer): RawGainMap | null => {
	const lib = libheif as any;
	let context: unknown = null;
	const allocated: number[] = [];
	const alloc = (bytes: number): number => {
		const p = lib._malloc(bytes);
		allocated.push(p);
		return p;
	};

	try {
		context = lib.heif_context_alloc();
		if (!context) return null;

		// `code` comes back as an Embind enum object, not a number, so compare its value --
		// `read.code !== 0` is true even on success.
		const read = lib.heif_context_read_from_memory(context, buffer);
		if (enumValue(read?.code) !== 0) {
			console.log('Could not parse HEIC for gain map:', read?.message);
			return null;
		}

		const primary = lib.heif_js_context_get_primary_image_handle(context);
		const handle = primary?.$$?.ptr;
		if (!handle) return null;

		// Filter 0 means "no filtering": return every auxiliary image attached.
		const auxCount = lib._heif_image_handle_get_number_of_auxiliary_images(handle, 0);
		if (auxCount < 1) return null;

		const idsPtr = alloc(4 * auxCount);
		const written = lib._heif_image_handle_get_list_of_auxiliary_image_IDs(handle, 0, idsPtr, auxCount);
		if (written < 1) return null;

		// `heif_error` (12 bytes) returned by value; 16 leaves room for alignment.
		const errPtr = alloc(16);
		const outPtr = alloc(4);

		// Apple attaches exactly one auxiliary image on HDR photos, but walk the list rather
		// than assuming index 0 is the gain map.
		for (let i = 0; i < written; i++) {
			const auxId = lib.HEAPU32[(idsPtr >> 2) + i];
			lib._heif_image_handle_get_auxiliary_image_handle(errPtr, handle, auxId, outPtr);
			if (lib.HEAP32[errPtr >> 2] !== 0) continue;

			const aux = lib.HEAPU32[outPtr >> 2];
			if (!aux) continue;

			const colorspace = enumValue(lib.heif_colorspace_monochrome);
			const chroma = enumValue(lib.heif_chroma_monochrome);
			const channel = enumValue(lib.heif_channel_Y);

			const imgPtr = alloc(4);
			lib._heif_decode_image(errPtr, aux, imgPtr, colorspace, chroma, 0);
			if (lib.HEAP32[errPtr >> 2] !== 0) {
				lib._heif_image_handle_release(aux);
				continue;
			}

			const img = lib.HEAPU32[imgPtr >> 2];
			const width = lib._heif_image_get_width(img, channel);
			const height = lib._heif_image_get_height(img, channel);

			const stridePtr = alloc(4);
			const plane = lib._heif_image_get_plane_readonly2(img, channel, stridePtr);
			const stride = lib.HEAP32[stridePtr >> 2];

			if (!plane || width <= 0 || height <= 0) {
				lib._heif_image_release(img);
				lib._heif_image_handle_release(aux);
				continue;
			}

			// Copy row by row: the decoded plane is stride-padded, and it lives in WASM
			// memory that is freed the moment the image is released.
			const data = Buffer.alloc(width * height);
			for (let y = 0; y < height; y++) {
				Buffer.from(lib.HEAPU8.buffer, plane + y * stride, width).copy(data, y * width);
			}

			lib._heif_image_release(img);
			lib._heif_image_handle_release(aux);
			return { width, height, data };
		}

		return null;
	} catch (e) {
		console.log('Error reading HEIC gain map', e);
		return null;
	} finally {
		for (const p of allocated) {
			try { (libheif as any)._free(p); } catch (e) { /* nothing useful to do */ }
		}
		if (context) {
			try { (libheif as any).heif_context_free(context); } catch (e) { /* ditto */ }
		}
	}
};
