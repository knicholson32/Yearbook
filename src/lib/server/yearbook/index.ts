/**
 * Reading published yearbooks.
 *
 * Everything here is **deliberately unscoped by group**. A published yearbook is the shared
 * artefact the whole family sees -- that is the entire point of publishing one -- so unlike
 * the upload pages it does not spread in `visibleImagesWhere`. Publishing is the consent
 * step, and only an admin can do it.
 *
 * Nothing here will return a year that has not been published, so an unpublished year stays
 * as private as it was before.
 */

import { prisma } from '$lib/server/db';
import { coverPhotos, planMonth, type LayoutPhoto } from '$lib/yearbook/layout';
import sharp from 'sharp';

/**
 * Embedded cover thumbnails, keyed by `id:updatedAt` so a re-cropped or rebuilt photo gets a
 * fresh one. Unbounded is fine: it holds a few kB per published cover photo.
 */
const embeddedCovers = new Map<string, string>();

/**
 * A small WebP of a stored 256px derivative, as a `data:` URI.
 *
 * Not the stored bytes themselves: for an HDR photo the 256 derivative is a JPEG carrying a
 * gain map, around 50kB, and SvelteKit writes page data into the HTML twice (the markup and
 * the hydration payload). Four of those put one shelf of covers past half a megabyte. A cover
 * photo is ghosted to 45% opacity, where HDR and fine detail are both invisible, so a lossy
 * SDR copy loses nothing that can be seen.
 */
const embedCover = async (id: string, updatedAt: Date, bytes: Uint8Array): Promise<string> => {
	const key = `${id}:${updatedAt.getTime()}`;
	const cached = embeddedCovers.get(key);
	if (cached !== undefined) return cached;

	// `.rotate()` first: some derivatives keep an EXIF orientation tag rather than having the
	// rotation baked in, and WebP output drops the tag -- without applying it the photo embeds
	// sideways.
	const webp = await sharp(Buffer.from(bytes))
		.rotate()
		.resize({ width: 200 })
		.webp({ quality: 50 })
		.toBuffer();
	const uri = `data:image/webp;base64,${webp.toString('base64')}`;
	embeddedCovers.set(key, uri);
	return uri;
};

/** The photo fields the layout and the page need, and nothing else. */
const PHOTO_SELECT = {
	id: true,
	caption: true,
	hex: true,
	width: true,
	height: true,
	date: true
} as const;

/**
 * Every photo in a year, in reading order: month, then the manual order within it.
 *
 * Pending photos are excluded. They have no month, so there is nowhere in the book to put
 * them -- and a year is not really finished while any are still sitting unfiled.
 */
const yearPhotos = async (year: number): Promise<LayoutPhoto[]> =>
	await prisma.image.findMany({
		where: { month: { yearId: year } },
		orderBy: [{ month: { month: 'asc' } }, { sort: 'asc' }, { date: 'asc' }],
		select: { ...PHOTO_SELECT, month: { select: { month: true } } }
	});

/** Covers for the shelf, newest first. */
export const publishedYears = async () => {
	const years = await prisma.year.findMany({
		where: { published: true },
		orderBy: { id: 'desc' },
		select: { id: true, title: true, publishedAt: true, photobookUrl: true }
	});

	// One query for the photos of every published year, rather than one per year.
	const photos = await prisma.image.findMany({
		where: { month: { yearId: { in: years.map((year) => year.id) } } },
		orderBy: [{ month: { month: 'asc' } }, { sort: 'asc' }, { date: 'asc' }],
		select: { ...PHOTO_SELECT, month: { select: { yearId: true } } }
	});

	// Four is enough to suggest the year without the cover becoming a grid itself.
	const covers = new Map(
		years.map((year) => [
			year.id,
			coverPhotos(
				photos.filter((photo) => photo.month?.yearId === year.id),
				4
			)
		])
	);

	/*
	 * The cover thumbnails travel inside the page as `data:` URIs.
	 *
	 * Fetched separately, they arrived after the covers had already painted and popped in one
	 * by one. Embedded, the covers are complete in the first paint. See `embedCover` for why
	 * the embedded copy is re-encoded rather than the stored bytes.
	 */
	const coverIds = [...covers.values()].flat().map((photo) => photo.id);
	const thumbs = await prisma.image.findMany({
		where: { id: { in: coverIds } },
		select: { id: true, i256: true, updatedAt: true }
	});
	const dataUri = new Map(
		await Promise.all(
			thumbs.map(async (thumb) => {
				try {
					return [thumb.id, await embedCover(thumb.id, thumb.updatedAt, thumb.i256)] as const;
				} catch (e) {
					// An unreadable blob falls back to a normal image URL rather than breaking the shelf.
					return [thumb.id, `/api/image/${thumb.id}/256`] as const;
				}
			})
		)
	);

	return years.map((year) => {
		const own = photos.filter((photo) => photo.month?.yearId === year.id);
		return {
			year: year.id,
			title: year.title,
			publishedAt: year.publishedAt?.getTime() ?? null,
			photobookUrl: year.photobookUrl,
			count: own.length,
			cover: (covers.get(year.id) ?? []).map((photo) => ({
				id: photo.id,
				hex: photo.hex,
				src: dataUri.get(photo.id) ?? `/api/image/${photo.id}/256`
			})),
			palette: own.slice(0, 6).map((photo) => photo.hex)
		};
	});
};

/**
 * One year's book, laid out.
 *
 * @returns null when the year is not published, so callers can 404 without a second check
 */
export const publishedYearbook = async (year: number) => {
	const row = await prisma.year.findUnique({
		where: { id: year },
		select: { id: true, title: true, published: true, publishedAt: true }
	});

	if (row === null || !row.published) return null;

	const photos = await yearPhotos(year);

	// Grouped in place: the query already ordered them, so this only has to split.
	const byMonth = new Map<number, LayoutPhoto[]>();
	for (const photo of photos) {
		const month = (photo as { month?: { month: number } | null }).month?.month ?? 0;
		const bucket = byMonth.get(month) ?? [];
		bucket.push(photo);
		byMonth.set(month, bucket);
	}

	const months = [...byMonth.entries()]
		.sort(([a], [b]) => a - b)
		.map(([month, monthPhotos]) => planMonth(month, monthPhotos));

	return {
		year: row.id,
		title: row.title,
		publishedAt: row.publishedAt?.getTime() ?? null,
		total: photos.length,
		months,
		// Six, because six fills every layout the cover uses exactly -- 2x3 on a phone, 3x2 on a
		// tablet, 6x1 on a desktop -- so no breakpoint is left with an empty cell.
		cover: coverPhotos(photos, 6).map((photo) => ({
			id: photo.id,
			hex: photo.hex,
			width: photo.width,
			height: photo.height
		})),
		palette: photos.slice(0, 8).map((photo) => photo.hex)
	};
};

/** Published years adjacent to this one, for moving between books. */
export const neighbouringYears = async (year: number) => {
	const [previous, next] = await Promise.all([
		prisma.year.findFirst({
			where: { published: true, id: { lt: year } },
			orderBy: { id: 'desc' },
			select: { id: true }
		}),
		prisma.year.findFirst({
			where: { published: true, id: { gt: year } },
			orderBy: { id: 'asc' },
			select: { id: true }
		})
	]);

	return { previous: previous?.id ?? null, next: next?.id ?? null };
};
