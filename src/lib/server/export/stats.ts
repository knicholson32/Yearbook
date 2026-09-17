/**
 * Counts for the admin dashboard.
 *
 * Deliberately unscoped: every query here reaches across all families, which is the whole
 * point of the admin view and the opposite of `visibleImagesWhere`. Only ever call these
 * behind `requireAdmin`.
 */

import { prisma } from '$lib/server/db';
import { familyLabel } from './naming';

/** A `where` on Image restricted to a year, or to one month of it. */
const scopeWhere = (year: number, month?: number) =>
	month === undefined
		? { month: { yearId: year } }
		: { month: { yearId: year, month } };

export interface PersonCount {
	id: string;
	name: string;
	familyId: string;
	count: number;
	/** Profile picture, so a list of people can show faces rather than just names. */
	imageId: string | null;
	/** Cache-buster for that picture; it changes when the image is rebuilt by a crop. */
	version: number | null;
}

/**
 * How many photos in the scope each person appears in.
 *
 * Counted per person rather than per photo, so the numbers do not sum to the photo total --
 * a photo with three people in it contributes to three rows.
 */
export const peopleCounts = async (year: number, month?: number): Promise<PersonCount[]> => {
	const people = await prisma.person.findMany({
		select: {
			id: true,
			name: true,
			familyId: true,
			imageId: true,
			profileImage: { select: { updatedAt: true } },
			_count: { select: { appearsIn: { where: scopeWhere(year, month) } } }
		},
		orderBy: { name: 'asc' }
	});

	return people
		.map((person) => ({
			id: person.id,
			name: person.name,
			familyId: person.familyId,
			count: person._count.appearsIn,
			imageId: person.imageId,
			version: person.profileImage?.updatedAt.getTime() ?? null
		}))
		// Someone who does not appear at all in this year is noise in a per-year view.
		.filter((person) => person.count > 0)
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export interface GroupCount {
	id: string;
	label: string;
	count: number;
}

/** Photo counts per family group in the scope, including groups that uploaded nothing. */
export const groupCounts = async (year: number, month?: number): Promise<GroupCount[]> => {
	const families = await prisma.family.findMany({
		select: { id: true, people: { select: { name: true } } }
	});

	// Ownership runs Image -> User -> Person -> Family, and `_count` cannot follow a chain
	// that long, so the tallies are counted here and matched up by family id.
	const images = await prisma.image.findMany({
		where: scopeWhere(year, month),
		select: { uploadedBy: { select: { person: { select: { familyId: true } } } } }
	});

	const tally = new Map<string, number>();
	for (const image of images) {
		const id = image.uploadedBy.person.familyId;
		tally.set(id, (tally.get(id) ?? 0) + 1);
	}

	return families
		.map((family) => ({
			id: family.id,
			label: familyLabel(family.people, family.id),
			count: tally.get(family.id) ?? 0
		}))
		.filter((group) => group.count > 0)
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

/** Total photos filed in the scope. */
export const imageCount = (year: number, month?: number): Promise<number> =>
	prisma.image.count({ where: scopeWhere(year, month) });

/** Photos uploaded to a year that never got a month. They are excluded from exports. */
export const pendingCount = (year: number): Promise<number> =>
	prisma.image.count({ where: { pendingForId: year } });
