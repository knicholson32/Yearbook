/**
 * Freezing a year.
 *
 * Two things freeze a year's photos: publishing it, and the admin's separate "lock" switch.
 * The lock exists so the admin can build the printed photo book from a set that will not
 * change underneath them, before the yearbook goes on the shelf. Either one means no edits,
 * no deletes, no refiling, no new uploads into it. Clearing whichever flags are set restores
 * all of it -- nothing here is destructive.
 *
 * Enforced on the server, not in the UI. The pages hide their controls for a locked year,
 * but that is a courtesy; these checks are what actually holds, including for an admin. An
 * admin who wants to change a frozen year unpublishes and unlocks it first.
 */

import { prisma } from '$lib/server/db';

/** Message used everywhere a locked year is refused, so the reason is always the same. */
export const LOCKED_MESSAGE =
	'That year is locked for the yearbook. An admin can reopen it from the admin dashboard.';

/**
 * Why a year is frozen. Published wins when both are set, since that is the one the family
 * can see, and unpublishing is the first thing an admin would have to undo.
 */
export type LockReason = 'published' | 'locked';

type LockFlags = { published: boolean; locked: boolean } | null | undefined;

const reasonFor = (flags: LockFlags): LockReason | null =>
	flags?.published ? 'published' : flags?.locked ? 'locked' : null;

/** Why a year is frozen, or null when it is open. */
export const yearLockReason = async (year: number): Promise<LockReason | null> =>
	reasonFor(
		await prisma.year.findUnique({
			where: { id: year },
			select: { published: true, locked: true }
		})
	);

/** Whether a year is published or locked, and therefore frozen. */
export const isYearLocked = async (year: number): Promise<boolean> =>
	(await yearLockReason(year)) !== null;

/**
 * Whether a photo sits in a frozen year.
 *
 * A photo still waiting in a year's pending queue counts too: it belongs to that year even
 * though it has no month, and letting it be filed into a frozen book would change the book.
 */
export const isImageLocked = async (imageId: string): Promise<boolean> => {
	const image = await prisma.image.findUnique({
		where: { id: imageId },
		select: {
			month: { select: { year: { select: { published: true, locked: true } } } },
			pendingFor: { select: { published: true, locked: true } }
		}
	});

	if (image === null) return false;
	return reasonFor(image.month?.year) !== null || reasonFor(image.pendingFor) !== null;
};

/**
 * Which of these years are frozen, in one query.
 *
 * For pages that render many photos: asking per photo would be a query each.
 */
export const lockedYears = async (years: number[]): Promise<Set<number>> => {
	if (years.length === 0) return new Set();
	const rows = await prisma.year.findMany({
		where: { id: { in: years }, OR: [{ published: true }, { locked: true }] },
		select: { id: true }
	});
	return new Set(rows.map((row) => row.id));
};
