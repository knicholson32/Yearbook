import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { UPLOADER_SELECT, canManageImage, visibleImagesWhere } from '$lib/server/auth';
import { pendingActions } from '$lib/server/image/pendingActions';
import { isValidYear } from '$lib/server/month';

export const load = async ({ params, locals }) => {
  const year = Number.parseInt(params.year, 10);
  if (!isValidYear(year)) error(404, 'No such year');

  const images = await prisma.image.findMany({
    where: { pendingForId: year, ...visibleImagesWhere(locals.user) },
    orderBy: [{ date: 'asc' }],
    include: { ...UPLOADER_SELECT }
  });

  return {
    year,
    images: images.map((image) => {
      const taken = new Date(image.date * 1000);
      return {
        id: image.id,
        caption: image.caption,
        hex: image.hex,
        date: image.date,
        capturedYear: taken.getUTCFullYear(),
        capturedMonth: taken.getUTCMonth() + 1,
        isHDR: image.isHDR,
        canManage: canManageImage(locals.user, image.uploadedBy.person.familyId)
      };
    })
  };
};

export const actions = pendingActions();
