import { prisma } from '$lib/server/db';
import { visibleImagesWhere, type SessionUser } from '$lib/server/auth';

/** Months are stored 1-12 to match how they are written in a URL. */
export const MIN_MONTH = 1;
export const MAX_MONTH = 12;

/** The earliest year the picker will offer. Photos older than this are unlikely here. */
export const MIN_YEAR = 1900;

export const isValidMonth = (month: number) =>
	Number.isInteger(month) && month >= MIN_MONTH && month <= MAX_MONTH;

export const isValidYear = (year: number) =>
	Number.isInteger(year) && year >= MIN_YEAR && year <= new Date().getFullYear() + 1;

/**
 * Parse `[year]` and `[month]` route params.
 * @returns the numbers, or null if either is out of range
 */
export const parseYearMonth = (
	yearParam: string,
	monthParam: string
): { year: number; month: number } | null => {
	const year = Number.parseInt(yearParam, 10);
	const month = Number.parseInt(monthParam, 10);
	if (!isValidYear(year) || !isValidMonth(month)) return null;
	return { year, month };
};

/**
 * Get the Month row for a year/month, creating it (and its Year) if it does not exist yet.
 * Rows are only created on demand so an untouched calendar stays empty in the database.
 * @returns the month id
 */
export const ensureMonth = async (year: number, month: number): Promise<string> => {
	await prisma.year.upsert({ where: { id: year }, update: {}, create: { id: year } });
	const row = await prisma.month.upsert({
		where: { yearId_month: { yearId: year, month } },
		update: {},
		create: { yearId: year, month }
	});
	return row.id;
};

/**
 * Photo count and cover images for each of the 12 months in a year.
 * @param year the year to summarize
 * @param user whose view of the year this is -- counts and covers are scoped to them
 */
export const getYearSummary = async (year: number, user: SessionUser | null) => {
	const months = await prisma.month.findMany({
		where: { yearId: year },
		include: {
			images: {
				where: visibleImagesWhere(user),
				orderBy: [{ sort: 'asc' }, { date: 'asc' }],
				select: {
					id: true,
					hex: true,
					updatedAt: true,
					includes: { select: { id: true, name: true, imageId: true } }
				}
			}
		}
	});

	const byMonth = new Map(months.map((m) => [m.month, m]));

	/**
	 * Pick a handful of photos to represent a month, spread evenly through it rather than
	 * taken from the front -- four shots from one afternoon say much less about a month
	 * than four from across it.
	 *
	 * @param images every photo in the month, in display order
	 * @param wanted how many to return at most
	 */
	const sample = <T>(images: T[], wanted: number): T[] => {
		if (images.length <= wanted) return images;
		const step = images.length / wanted;
		return Array.from({ length: wanted }, (_, i) => images[Math.floor(i * step)]);
	};

	return Array.from({ length: 12 }, (_, i) => {
		const row = byMonth.get(i + 1);
		const cover = row?.images[0] ?? null;

		// Who shows up in this month, each counted once however many photos they are in.
		const people = new Map<string, { id: string; name: string; imageId: string | null }>();
		for (const image of row?.images ?? []) {
			for (const person of image.includes) {
				if (!people.has(person.id)) people.set(person.id, person);
			}
		}

		return {
			month: i + 1,
			count: row?.images.length ?? 0,
			coverHex: cover?.hex ?? null,
			/** Up to four photos to tile across the month's card. */
			covers: sample(row?.images ?? [], 4).map((image) => ({
				id: image.id,
				version: image.updatedAt.getTime()
			})),
			people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
		};
	});
};

/** How many photos are parked in a year waiting to be assigned a month. */
export const getPendingCount = async (year: number, user: SessionUser | null): Promise<number> =>
	await prisma.image.count({ where: { pendingForId: year, ...visibleImagesWhere(user) } });

/**
 * Years the switcher should offer: any year this user actually has photos in, whether
 * filed into a month or still pending.
 */
export const getKnownYears = async (user: SessionUser | null): Promise<number[]> => {
	const scope = visibleImagesWhere(user);
	const [filed, pending] = await Promise.all([
		prisma.month.findMany({
			where: { images: { some: scope } },
			select: { yearId: true },
			distinct: ['yearId']
		}),
		prisma.image.findMany({
			where: { pendingForId: { not: null }, ...scope },
			select: { pendingForId: true },
			distinct: ['pendingForId']
		})
	]);

	const years = new Set<number>(filed.map((m) => m.yearId));
	for (const p of pending) if (p.pendingForId !== null) years.add(p.pendingForId);
	return [...years].sort((a, b) => a - b);
};
