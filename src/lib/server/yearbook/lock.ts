/**
 * Publishing freezes a year.
 *
 * A published yearbook is what the whole family reads, so its contents stop being editable
 * while it is on the shelf: no edits, no deletes, no refiling, no new uploads into it.
 * Unpublishing restores all of it -- nothing here is destructive, and the flag is the single
 * thing that decides.
 *
 * Enforced on the server, not in the UI. The pages hide their controls for a locked year,
 * but that is a courtesy; these checks are what actually holds, including for an admin. An
 * admin who wants to change a published year unpublishes it first.
 */

import { prisma } from '$lib/server/db';

/** Message used everywhere a locked year is refused, so the reason is always the same. */
export const LOCKED_MESSAGE =
	'That year is published. Unpublish it from the admin dashboard to make changes.';

/** Whether a year is published, and therefore frozen. */
export const isYearLocked = async (year: number): Promise<boolean> => {
	const row = await prisma.year.findUnique({
		where: { id: year },
		select: { published: true }
	});
	return row?.published === true;
};

/**
 * Whether a photo sits in a published year.
 *
 * A photo still waiting in a year's pending queue counts too: it belongs to that year even
 * though it has no month, and letting it be filed into a frozen book would change the book.
 */
export const isImageLocked = async (imageId: string): Promise<boolean> => {
	const image = await prisma.image.findUnique({
		where: { id: imageId },
		select: {
			month: { select: { year: { select: { published: true } } } },
			pendingFor: { select: { published: true } }
		}
	});

	if (image === null) return false;
	return image.month?.year.published === true || image.pendingFor?.published === true;
};

/**
 * Which of these years are locked, in one query.
 *
 * For pages that render many photos: asking per photo would be a query each.
 */
export const lockedYears = async (years: number[]): Promise<Set<number>> => {
	if (years.length === 0) return new Set();
	const rows = await prisma.year.findMany({
		where: { id: { in: years }, published: true },
		select: { id: true }
	});
	return new Set(rows.map((row) => row.id));
};
