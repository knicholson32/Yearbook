import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { requireAdmin, canManageImage } from '$lib/server/auth';
import { pendingActions } from '$lib/server/image/pendingActions';
import { familyLabel } from '$lib/server/export/naming';
import { isValidYear } from '$lib/server/month';

export const load = async ({ params, locals }) => {
  const user = requireAdmin(locals.user);

  const year = Number.parseInt(params.year, 10);
  if (!isValidYear(year)) error(404, 'No such year');

  // Unscoped, unlike the group's own queue: the admin dashboard already counts every
  // group's unfiled photos, so it has to be able to reach them too -- otherwise the
  // warning names photos nobody can act on.
  const images = await prisma.image.findMany({
    where: { pendingForId: year },
    orderBy: [{ date: 'asc' }],
    select: {
      id: true,
      caption: true,
      hex: true,
      date: true,
      isHDR: true,
      uploadedBy: {
        select: {
          gravatarHash: true,
          person: {
            select: {
              name: true,
              imageId: true,
              profileImage: { select: { updatedAt: true } },
              family: { select: { id: true, people: { select: { name: true } } } }
            }
          }
        }
      }
    }
  });

  return {
    year,
    images: images.map((image) => {
      const taken = new Date(image.date * 1000);
      const person = image.uploadedBy.person;
      return {
        id: image.id,
        caption: image.caption,
        hex: image.hex,
        date: image.date,
        capturedYear: taken.getUTCFullYear(),
        capturedMonth: taken.getUTCMonth() + 1,
        isHDR: image.isHDR,
        canManage: canManageImage(user, person.family.id),
        group: familyLabel(person.family.people, person.family.id),
        uploader: {
          name: person.name,
          imageId: person.imageId,
          gravatarHash: image.uploadedBy.gravatarHash,
          version: person.profileImage?.updatedAt.getTime() ?? null
        }
      };
    })
  };
};

/**
 * Form actions do not run `load`, so the guard above does not cover them -- each handler is
 * wrapped, the same as the admin month route.
 */
const actionsForAdmin = pendingActions({ allGroups: true });

export const actions = Object.fromEntries(
  Object.entries(actionsForAdmin).map(([name, handler]) => [
    name,
    async (event: Parameters<typeof handler>[0]) => {
      requireAdmin(event.locals.user);
      return await handler(event);
    }
  ])
) as typeof actionsForAdmin;
