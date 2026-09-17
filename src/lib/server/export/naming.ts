/**
 * Shared naming for the admin views and the archive layout, so a folder in the ZIP is
 * labelled with exactly the group name the admin clicked on.
 */

import { monthsFull } from '$lib/helpers';

export const MONTH_NAMES = monthsFull;

/**
 * A display name for a family group.
 *
 * `Family` has no name column -- a group is just the people in it -- so the label is built
 * from first names, which is how the rest of the app already refers to groups. The id tail
 * is the fallback rather than a decoration: an empty group would otherwise be an unnamed
 * folder colliding with every other empty group in the archive.
 */
export const familyLabel = (people: { name: string }[], familyId: string): string => {
	const names = people
		.map((person) => person.name.split(' ')[0])
		.filter((name) => name.length > 0);

	if (names.length === 0) return `Group ${familyId.slice(0, 8)}`;
	return names.join(', ');
};
