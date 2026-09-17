/**
 * Profile pictures for people.
 *
 * A profile picture is an ordinary `Image` row that a `Person` points at, so it goes
 * through the same pipeline as a photo -- same derivatives, same HDR handling, same
 * serving endpoint. It just has no month, which keeps it out of the calendar.
 */
import crypto from 'node:crypto';
import { prisma } from '$lib/server/db';
import { uploadImage } from '$lib/server/image';
import { deleteImages } from '$lib/server/image';

/** Gravatar wants the lowercased, trimmed email hashed with MD5. */
export const gravatarHash = (email: string | null | undefined): string =>
	email === null || email === undefined
		? '00000000000000000000000000000000'
		: crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');

/**
 * @param hash the gravatar hash for the address
 * @param size requested pixel size
 */
export const gravatarUrl = (hash: string, size = 512): string =>
	`https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;

type Result = { ok: true; imageId: string } | { ok: false; message: string };

/**
 * Store a new profile picture for a person, replacing whatever they had.
 *
 * @param personId who the picture belongs to
 * @param source an uploaded file, or a URL to fetch (used for the Gravatar fallback)
 * @param uploadedBy the user id to file the underlying image against
 */
export const setPersonProfileImage = async (
	personId: string,
	source: File | string,
	uploadedBy: string
): Promise<Result> => {
	const extension =
		typeof source === 'string'
			? 'png'
			: source.name.includes('.')
				? source.name.split('.').pop()!
				: 'jpg';

	// The stored extension is sniffed from the bytes, so a wrong guess here is harmless.
	const result = await uploadImage(source, extension, { userId: uploadedBy, maxMB: 25 });
	if (!result.success) return { ok: false, message: result.message };

	const previous = await prisma.person.findUnique({
		where: { id: personId },
		select: { imageId: true }
	});

	await prisma.person.update({ where: { id: personId }, data: { imageId: result.id } });

	// Drop the old picture only after the new one is attached, so a failure part-way
	// through leaves the person with a picture rather than none.
	if (previous?.imageId && previous.imageId !== result.id) {
		await deleteImages(previous.imageId);
	}

	return { ok: true, imageId: result.id };
};

/**
 * Give a person the Gravatar for an address, used when someone signs up without choosing
 * a picture of their own.
 */
export const setGravatarProfileImage = async (
	personId: string,
	email: string,
	uploadedBy: string
): Promise<Result> =>
	await setPersonProfileImage(personId, gravatarUrl(gravatarHash(email)), uploadedBy);
