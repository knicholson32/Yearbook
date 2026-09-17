/**
 * Building `srcset` candidate lists.
 *
 * Shared so the rule about the largest size lives in one place. The stored derivatives stop
 * at 2048, but `full` is the photograph at its own resolution -- so for anything bigger than
 * 2048 that is the only candidate that can satisfy a large window on a high-density display,
 * and without it the browser has no choice but to upscale the 2048.
 */

/** The stored derivative widths, smallest first. */
export const DERIVATIVE_WIDTHS = [128, 256, 512, 768, 1024, 2048] as const;

/** The largest stored derivative. Past this there is only `full`. */
export const LARGEST_DERIVATIVE = 2048;

/**
 * A `srcset` for one image.
 *
 * Candidates larger than the photograph itself are left out: the pipeline builds derivatives
 * `withoutEnlargement`, so a 900px original's "2048" is really 900px, and offering it as a
 * 2048 candidate would tell the browser it can serve a detail it does not have.
 *
 * @param id the image id
 * @param naturalWidth the photograph's own width in pixels
 * @param from the smallest candidate worth offering here
 */
export const srcsetFor = (id: string, naturalWidth: number, from = 512): string => {
	const widths = DERIVATIVE_WIDTHS.filter(
		(width) => width >= from && width < Math.max(naturalWidth, 1)
	);

	const candidates = widths.map((width) => `/api/image/${id}/${width} ${width}w`);

	// `full` is described by the photograph's real width, which is what lets the browser
	// weigh it against the fixed-size candidates rather than always taking the largest.
	if (naturalWidth > 0) {
		candidates.push(`/api/image/${id}/full ${naturalWidth}w`);
	}

	return candidates.join(', ');
};
