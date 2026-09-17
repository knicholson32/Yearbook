/**
 * Spotting a photo that is already in the yearbook.
 *
 * Several people photograph the same moment and then all upload it, or the same person
 * uploads a folder twice. Neither is an error worth refusing -- the upload goes through
 * either way -- but the uploader should be told, with enough detail to decide: who already
 * has it, where it is filed, what they called it, and who they tagged.
 *
 * **This reaches across groups on purpose.** A duplicate is only useful to know about if it
 * covers the whole book, so the warning can name a person and a caption from another family.
 * It is the one place outside the admin area and a published yearbook that does so.
 */

import { prisma } from '$lib/server/db';
import { monthsFull } from '$lib/helpers';

/**
 * Bits that may differ before two photos are considered different.
 *
 * The stored hash is perceptual, not a checksum: it survives re-encoding, resizing and
 * mild edits, which is exactly what is wanted -- the same photo sent once from Photos and
 * once through a messaging app should still match. The cost is that it can also match two
 * genuinely different frames of the same scene, so this is a *warning*, never a refusal.
 *
 * Zero means the fingerprints are identical. Five of 64 bits is tight enough that ordinary
 * burst frames stay distinct.
 */
const MAX_DISTANCE = 5;

/** Hamming distance between two hex-encoded hashes, or null if they aren't comparable. */
export const hexDistance = (a: string, b: string): number | null => {
	if (a.length !== b.length || a.length === 0) return null;

	let distance = 0;
	for (let i = 0; i < a.length; i++) {
		const left = parseInt(a[i], 16);
		const right = parseInt(b[i], 16);
		if (Number.isNaN(left) || Number.isNaN(right)) return null;

		// Popcount of the nibble difference.
		let diff = left ^ right;
		while (diff !== 0) {
			distance += diff & 1;
			diff >>= 1;
		}
	}

	return distance;
};

export interface DuplicateMatch {
	id: string;
	/** 0 when the fingerprints are identical, otherwise how many bits differ. */
	distance: number;
	exact: boolean;
	uploader: string;
	/** Whether the uploader is in the same group as whoever is being warned. */
	sameGroup: boolean;
	/** "August 2026", or null while the match is still unfiled. */
	filed: string | null;
	caption: string | null;
	people: string[];
}

/**
 * Find an already-stored photo that matches this one.
 *
 * @param hash the new photo's perceptual hash
 * @param excludeId the new photo's own id, so it cannot match itself
 * @param viewerFamilyId the uploader's group, only used to label the match
 * @returns the closest match within the threshold, or null
 */
export const findDuplicate = async (
	hash: string,
	excludeId: string,
	viewerFamilyId: string | null
): Promise<DuplicateMatch | null> => {
	if (hash === '') return null;

	// Hamming distance cannot be expressed in a SQLite `where`, so the comparison happens
	// here. Only id and hash are fetched -- 16 characters a row -- which stays cheap well
	// past the size a family yearbook reaches. If this ever holds a very large library, the
	// fix is a prefix index on the hash, not a different algorithm.
	const candidates = await prisma.image.findMany({
		where: { id: { not: excludeId } },
		select: { id: true, hash: true }
	});

	let best: { id: string; distance: number } | null = null;
	for (const candidate of candidates) {
		const distance = hexDistance(hash, candidate.hash);
		if (distance === null || distance > MAX_DISTANCE) continue;
		if (best === null || distance < best.distance) best = { id: candidate.id, distance };
		if (distance === 0) break;
	}

	if (best === null) return null;

	const match = await prisma.image.findUnique({
		where: { id: best.id },
		select: {
			id: true,
			caption: true,
			pendingForId: true,
			month: { select: { month: true, yearId: true } },
			includes: { select: { name: true } },
			uploadedBy: {
				select: { person: { select: { name: true, familyId: true } } }
			}
		}
	});

	// It could have been deleted between the two queries.
	if (match === null) return null;

	// Only used to build the "filed" label -- the warning deliberately offers no way to open
	// the existing photo, so neither value is sent to the client.
	const month = match.month?.month ?? null;
	const year = match.month?.yearId ?? match.pendingForId ?? null;

	return {
		id: match.id,
		distance: best.distance,
		exact: best.distance === 0,
		uploader: match.uploadedBy.person.name,
		sameGroup:
			viewerFamilyId !== null && match.uploadedBy.person.familyId === viewerFamilyId,
		filed: month === null ? null : `${monthsFull[month - 1]} ${year}`,
		caption: match.caption,
		people: match.includes.map((person) => person.name)
	};
};
