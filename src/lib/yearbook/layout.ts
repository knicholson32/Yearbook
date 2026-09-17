/**
 * Turning a year's photos into yearbook pages.
 *
 * The rule that shapes everything here: **no photo is ever cropped**. A grid of uniform
 * squares is what the upload pages do, and it reads like a contact sheet -- every picture
 * cut to the same shape, nothing louder than anything else. A yearbook is the opposite: the
 * page is cut to fit the pictures.
 *
 * So rows are justified. Photos keep their own aspect ratio, and the row's height falls out
 * of how many were placed in it: a row of four wide landscapes is short, a row containing a
 * portrait is tall. Both edges stay flush, which is what makes a page look set rather than
 * tiled.
 *
 * All of it is pure and deterministic -- the same photos always produce the same book. That
 * matters more than it sounds: a layout that reshuffled on every load would make a
 * "yearbook" that is different each time you open it, and would make any visual check
 * meaningless.
 */

export interface LayoutPhoto {
	id: string;
	caption: string | null;
	hex: string;
	width: number;
	height: number;
	date: number;
}

/** One photo placed in a row, with the share of the row's width it takes. */
export interface PlacedPhoto {
	photo: LayoutPhoto;
	/**
	 * The photo's own aspect ratio, used as its flex-grow factor. Growing by aspect rather
	 * than setting a width percentage is what makes the gaps come out right: percentages are
	 * of the full row including gaps, so they overflow by the gap total, while flex
	 * distributes only the space actually left over.
	 */
	aspect: number;
	/** The same share as a percentage, for `sizes` -- which cannot read a flex factor. */
	widthPercent: number;
}

export type Block =
	/** A single photo given the full width, for a moment worth pausing on. */
	| { kind: 'feature'; photo: LayoutPhoto; aspect: number }
	/** A justified row: total aspect decides the height, each photo keeps its shape. */
	| {
			kind: 'row';
			items: PlacedPhoto[];
			aspect: number;
			/**
			 * Whether the photos stretch to both edges. False for a trailing row that never
			 * reached a full width: it keeps normal height and simply ends short, the way the
			 * last line of a paragraph does. Stretching it instead would blow one photo up to
			 * the width of three and crop away most of it.
			 */
			fill: boolean;
	  };

export interface MonthPages {
	month: number;
	count: number;
	blocks: Block[];
	/** Photos in this month carrying a caption, used for the month's opening quote. */
	captioned: number;
}

/**
 * A photo's width-to-height ratio, clamped.
 *
 * The clamp is a guard against one pathological image dictating a whole row: a panorama at
 * 6:1 would flatten its row to a letterbox strip, and a scan cropped to a sliver would make
 * its row absurdly tall. Both still render uncropped, just inside a sane row.
 */
export const aspectOf = (photo: LayoutPhoto): number => {
	if (photo.width <= 0 || photo.height <= 0) return 1;
	return Math.min(2.6, Math.max(0.5, photo.width / photo.height));
};

/**
 * Total aspect a row aims for, which is really "how many photos across".
 *
 * Around 3 means roughly three landscape photos or four portraits per row -- busy enough to
 * feel like a spread, open enough that faces are still legible.
 */
const TARGET_ROW_ASPECT = 3.1;

/** A row is cut short rather than overstuffed once it passes this. */
const MAX_ROW_ASPECT = 4.2;

/**
 * Whether a photo should be given the whole width to itself.
 *
 * Two reasons to promote one: it opens a month, or it carries a caption long enough to be a
 * story rather than a label. Both are editorial signals that already exist in the data --
 * nobody has to mark a photo as important.
 */
const isFeature = (
	photo: LayoutPhoto,
	indexInMonth: number,
	total: number,
	sinceLastFeature: number
): boolean => {
	if (total >= 3 && indexInMonth === 0) return true;

	// A month where everything is captioned would otherwise become a column of full-width
	// photos -- which is not a yearbook, it is a slideshow. Features have to earn their place
	// by being spaced out, so there is something for them to stand out from.
	if (sinceLastFeature < 3) return false;

	const caption = photo.caption?.trim() ?? '';
	return caption.length >= 60;
};

/**
 * Lay out one month.
 *
 * Photos arrive in the order they are filed and stay in it. Rows are filled greedily: keep
 * adding until the row is wide enough, then justify it. The last row of a month is left at
 * whatever height it naturally reached rather than being stretched to fill -- a stretched
 * final row of one photo is the classic tell of an automated gallery.
 */
export const planMonth = (month: number, photos: LayoutPhoto[]): MonthPages => {
	const blocks: Block[] = [];
	let pending: LayoutPhoto[] = [];

	const flush = (isLast: boolean) => {
		if (pending.length === 0) return;

		const aspects = pending.map(aspectOf);
		const total = aspects.reduce((sum, a) => sum + a, 0);

		// A trailing row that never reached the target keeps a normal row's height and stops
		// where it stops, rather than being justified out to the full width.
		const fill = !(isLast && total < TARGET_ROW_ASPECT * 0.8);
		const rowAspect = fill ? total : TARGET_ROW_ASPECT;

		blocks.push({
			kind: 'row',
			aspect: rowAspect,
			fill,
			items: pending.map((photo, i) => ({
				photo,
				aspect: aspects[i],
				// When filling, the share is of the row; when not, it is whatever this photo
				// genuinely occupies at the row's height, which is what leaves the gap at the
				// end instead of inside the pictures.
				widthPercent: (aspects[i] / rowAspect) * 100
			}))
		});
		pending = [];
	};

	let sinceLastFeature = Number.MAX_SAFE_INTEGER;

	photos.forEach((photo, index) => {
		if (isFeature(photo, index, photos.length, sinceLastFeature)) {
			flush(false);
			blocks.push({ kind: 'feature', photo, aspect: aspectOf(photo) });
			sinceLastFeature = 0;
			return;
		}

		sinceLastFeature += 1;

		pending.push(photo);
		const total = pending.map(aspectOf).reduce((sum, a) => sum + a, 0);
		if (total >= TARGET_ROW_ASPECT || total >= MAX_ROW_ASPECT) flush(false);
	});

	flush(true);

	return {
		month,
		count: photos.length,
		blocks,
		captioned: photos.filter((photo) => (photo.caption?.trim() ?? '') !== '').length
	};
};

/**
 * A handful of colours drawn from the year's own photos, for the cover.
 *
 * Every photo already carries its average colour from upload, so a year has a palette
 * without anything being computed over the images again. Sampling evenly across the year
 * rather than taking the first few means a cover reflects the whole of it -- otherwise
 * every January-heavy year comes out the same colour.
 */
export const coverPalette = (photos: LayoutPhoto[], count = 5): string[] => {
	const usable = photos.filter((photo) => /^#[0-9a-f]{6}$/i.test(photo.hex));
	if (usable.length === 0) return ['#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8'];

	const step = Math.max(1, Math.floor(usable.length / count));
	const picked: string[] = [];
	for (let i = 0; i < usable.length && picked.length < count; i += step) {
		picked.push(usable[i].hex);
	}

	// A very short year still deserves a full palette; cycle the colours it does have rather
	// than leaving gaps. Read from a snapshot, since `picked` is growing as we go.
	const base = [...picked];
	for (let i = 0; picked.length < count; i++) picked.push(base[i % base.length]);
	return picked;
};

/**
 * Photos for the cover mosaic, spread across the year rather than clustered.
 */
export const coverPhotos = (photos: LayoutPhoto[], count: number): LayoutPhoto[] => {
	if (photos.length <= count) return photos;
	const step = photos.length / count;
	return Array.from({ length: count }, (_, i) => photos[Math.floor(i * step)]);
};
