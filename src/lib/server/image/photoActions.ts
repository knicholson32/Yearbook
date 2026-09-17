/**
 * The form actions behind the photo dialog.
 *
 * Shared rather than duplicated: the dialog is used on both the group's own month page and
 * the admin month page, and it posts to whatever route it is rendered under. Two copies of
 * these handlers would be two copies of the authorization, which is exactly the thing that
 * must not drift.
 *
 * Both routes are `[year]/[month]`, so the handlers that need the month on screen can read
 * `params` the same way from either.
 */

import { fail } from '@sveltejs/kit';
import type { Actions, RequestEvent } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { UPLOADER_SELECT, canManageImage } from '$lib/server/auth';
import { deleteImages } from '$lib/server/image';
import { ensureMonth, parseYearMonth } from '$lib/server/month';
import { LOCKED_MESSAGE, isImageLocked, isYearLocked } from '$lib/server/yearbook/lock';

/** Load an image and confirm the caller is allowed to change it. */
const authorize = async (locals: App.Locals, imageId: string) => {
  if (locals.user === null) return { error: fail(401, { message: 'Not signed in' }) } as const;
  const image = await prisma.image.findUnique({ where: { id: imageId }, select: UPLOADER_SELECT });
  if (image === null) return { error: fail(404, { message: 'Photo not found' }) } as const;
  if (!canManageImage(locals.user, image.uploadedBy.person.familyId)) {
    return { error: fail(403, { message: 'That photo belongs to another group' }) } as const;
  }
  // A published year is frozen for everyone, admins included. 423 rather than 403: the
  // caller is allowed to edit this photo, just not while its book is on the shelf.
  if (await isImageLocked(imageId)) {
    return { error: fail(423, { message: LOCKED_MESSAGE }) } as const;
  }
  return { error: null } as const;
};

/**
 * Spread into a route's `actions` so the photo dialog works there.
 *
 * `satisfies` rather than a plain annotation: it supplies the argument types the handlers
 * lost by moving out of a route file, while leaving each action's own return type intact so
 * callers still see what a form result carries.
 */
export const photoActions = {
  /** Save the caption and the list of people in a photo. */
  details: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    if (id === undefined || id === '') return fail(400, { message: 'Missing photo id' });

    const { error: denied } = await authorize(locals, id);
    if (denied !== null) return denied;

    const caption = data.get('caption')?.toString().trim() ?? '';
    // One `people` entry per tagged person; `set` replaces the whole list in one go.
    const personIds = data.getAll('people').map((p) => p.toString()).filter((p) => p !== '');

    try {
      await prisma.image.update({
        where: { id },
        data: {
          caption: caption === '' ? null : caption,
          includes: { set: personIds.map((personId) => ({ id: personId })) }
        }
      });
    } catch (e) {
      console.log('Error saving photo details', e);
      return fail(500, { message: 'Could not save. See logs.' });
    }

    return { success: true };
  },

  /** Remove a photo and its derivatives. */
  delete: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    if (id === undefined || id === '') return fail(400, { message: 'Missing photo id' });

    const { error: denied } = await authorize(locals, id);
    if (denied !== null) return denied;

    if (!(await deleteImages(id))) return fail(500, { message: 'Could not delete. See logs.' });
    return { success: true };
  },

  /** Swap a photo's position with its neighbour in the month. */
  move: async ({ request, locals, params }) => {
    const parsed = parseYearMonth(params.year, params.month);
    if (parsed === null) return fail(404, { message: 'No such month' });

    const data = await request.formData();
    const id = data.get('id')?.toString();
    const direction = data.get('direction')?.toString();
    if (id === undefined || id === '') return fail(400, { message: 'Missing photo id' });
    if (direction !== 'up' && direction !== 'down') return fail(400, { message: 'Bad direction' });

    if (locals.user === null) return fail(401, { message: 'Not signed in' });
    if (await isYearLocked(parsed.year)) return fail(423, { message: LOCKED_MESSAGE });

    const siblings = await prisma.image.findMany({
      where: { month: { yearId: parsed.year, month: parsed.month } },
      orderBy: [{ sort: 'asc' }, { date: 'asc' }],
      select: { id: true }
    });

    const index = siblings.findIndex((s) => s.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= siblings.length) return { success: true };

    // Rewrite every sort value from the reordered list so ties and gaps can't accumulate.
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    try {
      await prisma.$transaction(
        reordered.map((image, i) => prisma.image.update({ where: { id: image.id }, data: { sort: i } }))
      );
    } catch (e) {
      console.log('Error reordering photos', e);
      return fail(500, { message: 'Could not reorder. See logs.' });
    }

    return { success: true };
  },

  /**
   * Move one photo to an explicit month.
   *
   * Used by both the quick arrows and the picker in the photo dialog; `refile` below is the
   * separate "put it where its EXIF says" shortcut.
   */
  moveToMonth: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    if (id === undefined || id === '') return fail(400, { message: 'Missing photo id' });

    const { error: denied } = await authorize(locals, id);
    if (denied !== null) return denied;

    const target = parseYearMonth(data.get('year')?.toString() ?? '', data.get('month')?.toString() ?? '');
    if (target === null) return fail(400, { message: 'That is not a month we can file into' });
    // `authorize` covered where it is coming from; this is where it is going.
    if (await isYearLocked(target.year)) return fail(423, { message: LOCKED_MESSAGE });

    try {
      const monthId = await ensureMonth(target.year, target.month);
      const last = await prisma.image.findFirst({
        where: { monthId },
        orderBy: { sort: 'desc' },
        select: { sort: true }
      });
      // Moving into a month appends, and clears any pending state the photo carried.
      await prisma.image.update({
        where: { id },
        data: { monthId, pendingForId: null, sort: (last?.sort ?? -1) + 1 }
      });
    } catch (e) {
      console.log('Error moving photo', e);
      return fail(500, { message: 'Could not move that photo. See logs.' });
    }

    return { success: true, year: target.year, month: target.month };
  },

  /** Stop warning that this photo's capture date disagrees with the month it is filed in. */
  dismissDateWarning: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    if (id === undefined || id === '') return fail(400, { message: 'Missing photo id' });

    const { error: denied } = await authorize(locals, id);
    if (denied !== null) return denied;

    try {
      await prisma.image.update({ where: { id }, data: { dateWarningDismissed: true } });
    } catch (e) {
      console.log('Error dismissing date warning', e);
      return fail(500, { message: 'Could not dismiss. See logs.' });
    }
    return { success: true };
  },

  /**
   * Move photos into the month they were actually taken, by their EXIF capture date.
   */
  refile: async ({ request, locals }) => {
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const data = await request.formData();
    const ids = data.getAll('id').map((i) => i.toString()).filter((i) => i !== '');
    if (ids.length === 0) return fail(400, { message: 'Nothing to move' });

    const images = await prisma.image.findMany({
      where: { id: { in: ids } },
      select: { id: true, date: true, ...UPLOADER_SELECT }
    });

    // Group by the month each photo's own date lands in, so one action can scatter a mixed
    // drop across several months.
    const byMonth = new Map<string, { year: number; month: number; ids: string[] }>();
    for (const image of images) {
      if (!canManageImage(locals.user, image.uploadedBy.person.familyId)) continue;
      // Both ends: a photo cannot leave a published book, nor drop into one.
      if (await isImageLocked(image.id)) continue;
      const taken = new Date(image.date * 1000);
      const year = taken.getUTCFullYear();
      const month = taken.getUTCMonth() + 1;
      const key = `${year}-${month}`;
      const bucket = byMonth.get(key) ?? { year, month, ids: [] };
      bucket.ids.push(image.id);
      byMonth.set(key, bucket);
    }

    try {
      for (const { year, month, ids: moving } of byMonth.values()) {
        if (await isYearLocked(year)) continue;
        const monthId = await ensureMonth(year, month);
        const last = await prisma.image.findFirst({
          where: { monthId },
          orderBy: { sort: 'desc' },
          select: { sort: true }
        });
        let sort = (last?.sort ?? -1) + 1;
        for (const id of moving) {
          await prisma.image.update({ where: { id }, data: { monthId, sort: sort++ } });
        }
      }
    } catch (e) {
      console.log('Error refiling photos', e);
      return fail(500, { message: 'Could not move those photos. See logs.' });
    }

    // Report where a single photo went, so the dialog can follow it there.
    const only = byMonth.size === 1 ? [...byMonth.values()][0] : null;
    return {
      success: true,
      moved: images.length,
      year: only?.year ?? null,
      month: only?.month ?? null
    };
  },

  /** Create a Person so they can be tagged. Person.family is required, so a family is too. */
  createPerson: async ({ request, locals }) => {
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const data = await request.formData();
    const name = data.get('name')?.toString().trim();
    if (name === undefined || name === '') return fail(400, { message: 'Name required' });

    // Normally the caller's own group, never whatever the form claimed. An admin tagging
    // another group's photo is the one case where the form may name a different family --
    // otherwise the new person would land in the admin's own group and be untaggable here.
    const requested = data.get('familyId')?.toString();
    const familyId =
      locals.user.role === 'admin' && requested !== undefined && requested !== ''
        ? requested
        : locals.user.person.familyId;

    try {
      const person = await prisma.person.create({ data: { name, familyId } });
      return { success: true, personId: person.id };
    } catch (e) {
      // Person.name is globally unique, so a duplicate anywhere in the database lands here.
      console.log('Error creating person', e);
      return fail(400, { message: `Could not add "${name}". That name may already exist.` });
    }
  }
} satisfies Actions<{ year: string; month: string }>;
