/**
 * The colour a year is bound in.
 *
 * Averaging the photos' own average colours gives something that genuinely belongs to that
 * year, but in sRGB it also reliably comes out mud: mixing enough colours converges on grey.
 * So this only produces the *hue*, and the saturation and lightness are set in CSS with
 * relative colour syntax -- `oklch(from var(--tint) <l> <c> h)` keeps the year's hue while
 * forcing a deep, saturated, consistently readable cover.
 */

/** Average of the supplied colours, as a plain hex. Hue is the part that matters. */
export const averageHex = (palette: string[]): string => {
	const valid = palette.filter((hex) => /^#[0-9a-f]{6}$/i.test(hex));
	if (valid.length === 0) return '#4a5568';

	const mix = valid.reduce(
		(acc, hex) => {
			acc.r += parseInt(hex.slice(1, 3), 16);
			acc.g += parseInt(hex.slice(3, 5), 16);
			acc.b += parseInt(hex.slice(5, 7), 16);
			return acc;
		},
		{ r: 0, g: 0, b: 0 }
	);

	const channel = (total: number) =>
		Math.round(total / valid.length)
			.toString(16)
			.padStart(2, '0');

	return `#${channel(mix.r)}${channel(mix.g)}${channel(mix.b)}`;
};
