/**
 * `libheif-js` ships no type declarations. This covers the decode path used by
 * `$lib/server/image` to read the HEICs that iPhones produce, which the prebuilt `sharp`
 * binaries cannot (they carry AVIF but not HEVC).
 */
declare module 'libheif-js' {
	export interface HeifImage {
		get_width(): number;
		get_height(): number;
		/**
		 * Decode into `target.data` as RGBA. Calls back with the same object, or null on
		 * failure.
		 */
		display(
			target: { width: number; height: number; data: Uint8Array },
			callback: (result: { width: number; height: number; data: Uint8Array } | null) => void
		): void;
	}

	export class HeifDecoder {
		decode(buffer: Uint8Array): HeifImage[];
	}

	/**
	 * The module also re-exports libheif's whole C API as raw WASM functions plus the
	 * Emscripten heap views. `$lib/server/image/heic` uses those to reach the
	 * auxiliary-image calls the typed wrapper above does not cover, so the default export
	 * is deliberately loose.
	 */
	const libheif: { HeifDecoder: typeof HeifDecoder } & Record<string, any>;
	export default libheif;
}
