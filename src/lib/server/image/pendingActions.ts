/**
 * Filing photos that arrived without a month.
 *
 * Shared between a group's own pending queue and the admin's, which differ in exactly one
 * way: whose photos the bulk action sweeps. `assign` and `delete` need no such switch --
 * they authorize per photo through `canManageImage`, which already lets an admin through.
 */

import { fail } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { UPLOADER_SELECT, canManageImage, visibleImagesWhere } from '$lib/server/auth';
import { deleteImages } from '$lib/server/image';
import { ensureMonth, isValidMonth, isValidYear } from '$lib/server/month';
import { LOCKED_MESSAGE, isImageLocked, isYearLocked } from '$lib/server/yearbook/lock';

/** Confirm the caller may touch this photo. */
const authorize = async (locals: App.Locals, id: string) => {
  if (locals.user === null) return fail(401, { message: 'Not signed in' });
  const image = await prisma.image.findUnique({ where: { id }, select: UPLOADER_SELECT });
  if (image === null) return fail(404, { message: 'Photo not found' });
  if (!canManageImage(locals.user, image.uploadedBy.person.familyId)) {
    return fail(403, { message: 'That photo belongs to another group' });
  }
  if (await isImageLocked(id)) return fail(423, { message: LOCKED_MESSAGE });
  return null;
};

export interface PendingActionOptions {
	/**
	 * Sweep every group's pending photos rather than only the caller's.
	 *
	 * Only ever true on the admin route. The group's own queue stays scoped even for an
	 * admin, so "file everything" there cannot quietly reach into another family.
	 */
	allGroups?: boolean;
}

/** Spread into a route's `actions` to give it a pending queue. */
export const pendingActions = ({ allGroups = false }: PendingActionOptions = {}) =>
	({
  /** File a pending photo into a month, clearing its pending flag. */
  assign: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const year = Number.parseInt(data.get('year')?.toString() ?? '', 10);
    const month = Number.parseInt(data.get('month')?.toString() ?? '', 10);

    if (id === undefined || id === '') return fail(400, { message: 'Missing photo id' });
    if (!isValidYear(year) || !isValidMonth(month)) {
      return fail(400, { message: 'That is not a month we can file into' });
    }

    const denied = await authorize(locals, id);
    if (denied !== null) return denied;
    // Where it is going, as well as where it is now.
    if (await isYearLocked(year)) return fail(423, { message: LOCKED_MESSAGE });

    try {
      const monthId = await ensureMonth(year, month);
      const last = await prisma.image.findFirst({
        where: { monthId },
        orderBy: { sort: 'desc' },
        select: { sort: true }
      });
      await prisma.image.update({
        where: { id },
        data: { monthId, pendingForId: null, sort: (last?.sort ?? -1) + 1 }
      });
    } catch (e) {
      console.log('Error assigning pending photo', e);
      return fail(500, { message: 'Could not file that photo. See logs.' });
    }

    return { success: true };
  },

  /**
   * File every pending photo whose capture date falls in a real month, in one go. Photos
   * with no usable date stay put.
   */
  assignAllByDate: async ({ params, locals }) => {
    if (locals.user === null) return fail(401, { message: 'Not signed in' });
    const year = Number.parseInt(params.year, 10);
    if (!isValidYear(year)) return fail(404, { message: 'No such year' });

    const images = await prisma.image.findMany({
      where: allGroups
        ? { pendingForId: year }
        : { pendingForId: year, ...visibleImagesWhere(locals.user) },
      select: { id: true, date: true, ...UPLOADER_SELECT }
    });

    let filed = 0;
    try {
      for (const image of images) {
        if (!canManageImage(locals.user, image.uploadedBy.person.familyId)) continue;
        if (await isImageLocked(image.id)) continue;
        const taken = new Date(image.date * 1000);
        if (await isYearLocked(taken.getUTCFullYear())) continue;
        const monthId = await ensureMonth(taken.getUTCFullYear(), taken.getUTCMonth() + 1);
        const last = await prisma.image.findFirst({
          where: { monthId },
          orderBy: { sort: 'desc' },
          select: { sort: true }
        });
        await prisma.image.update({
          where: { id: image.id },
          data: { monthId, pendingForId: null, sort: (last?.sort ?? -1) + 1 }
        });
        filed++;
      }
    } catch (e) {
      console.log('Error filing pending photos', e);
      return fail(500, { message: 'Could not file those photos. See logs.' });
    }

    return { success: true, filed };
  },

  delete: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    if (id === undefined || id === '') return fail(400, { message: 'Missing photo id' });

    const denied = await authorize(locals, id);
    if (denied !== null) return denied;

    if (!(await deleteImages(id))) return fail(500, { message: 'Could not delete. See logs.' });
    return { success: true };
  }
} satisfies Actions<{ year: string }>);
