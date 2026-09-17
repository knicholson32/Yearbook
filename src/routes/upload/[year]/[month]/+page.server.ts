import { error, fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { UPLOADER_SELECT, canManageImage, visibleImagesWhere } from '$lib/server/auth';
import { photoActions } from '$lib/server/image/photoActions';
import { ensureMonth, parseYearMonth } from '$lib/server/month';
import * as settings from '$lib/server/settings';
import { LOCKED_MESSAGE, isYearLocked, lockedYears } from '$lib/server/yearbook/lock';

export const load = async ({ params, locals }) => {
  const parsed = parseYearMonth(params.year, params.month);
  if (parsed === null) error(404, 'No such month');
  const { year, month } = parsed;

  const row = await prisma.month.findUnique({
    where: { yearId_month: { yearId: year, month } },
    include: {
      images: {
        where: visibleImagesWhere(locals.user),
        orderBy: [{ sort: 'asc' }, { date: 'asc' }],
        include: { includes: { select: { id: true, name: true } }, ...UPLOADER_SELECT }
      }
    }
  });

  // The group's own note about this month. Never anyone else's.
  const familyId = locals.user?.person.familyId ?? null;
  const monthCaption =
    row === null || familyId === null
      ? null
      : await prisma.monthCaption.findUnique({
          where: { monthId_familyId: { monthId: row.id, familyId } }
        });

  const columns = await settings.get('upload.monthColumns');
  const locked = await isYearLocked(year);

  const [people, families] = await Promise.all([
    // Everyone, deliberately unscoped. Groups mix at the events these photos come from, so
    // a photo often contains people from another family and has to be able to say so. What
    // is private is a group's *photos*, not the existence of its people -- the `where` on
    // `images` above is what enforces that.
    prisma.person.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    }),
    // Only the caller's own group: a person added from here joins it, and picking someone
    // else's family is not on offer.
    prisma.family.findMany({
      where: { id: locals.user?.person.familyId ?? '__nobody__' },
      include: { people: { select: { name: true } } }
    })
  ]);

  return {
    year,
    month,
    columns,
    locked,
    caption: monthCaption?.text ?? '',
    captionUpdatedAt: monthCaption?.updatedAt.getTime() ?? null,
    captionUpdatedBy: monthCaption?.updatedBy ?? null,
    canCaption: familyId !== null && !locked,
    images: (row?.images ?? []).map((image) => {
      // Derived per photo rather than reported once after an upload, so a photo refiled by
      // hand -- or uploaded before any of this existed -- is flagged just the same.
      const taken = new Date(image.date * 1000);
      const capturedYear = taken.getUTCFullYear();
      const capturedMonth = taken.getUTCMonth() + 1;

      return {
        id: image.id,
        caption: image.caption,
        sort: image.sort,
        date: image.date,
        hex: image.hex,
        width: image.width,
        height: image.height,
        // Folded into `canManage` rather than checked separately, so every control that
        // already respects it is covered without touching the template.
        canManage: !locked && canManageImage(locals.user, image.uploadedBy.person.familyId),
        includes: image.includes,
        latitude: image.latitude,
        longitude: image.longitude,
        altitude: image.altitude,
        make: image.make,
        model: image.model,
        lens: image.lens,
        isHDR: image.isHDR,
        capturedYear,
        capturedMonth,
        misfiled:
          !image.dateWarningDismissed && (capturedYear !== year || capturedMonth !== month)
      };
    }),
    people,
    families: families.map((f) => ({
      id: f.id,
      label: f.people.map((p) => p.name.split(' ')[0]).join(', ') || 'Unnamed family'
    }))
  };
};

export const actions = {
  ...photoActions,

  saveCaption: async ({ request, locals, params }) => {
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const parsed = parseYearMonth(params.year, params.month);
    if (parsed === null) return fail(404, { message: 'No such month' });
    if (await isYearLocked(parsed.year)) return fail(423, { message: LOCKED_MESSAGE });

    const text = data.get('caption')?.toString().trim() ?? '';
    if (text.length > 2000) return fail(400, { message: 'That caption is too long' });

    const familyId = locals.user.person.familyId;

    try {
      const monthId = await ensureMonth(parsed.year, parsed.month);

      if (text === '') {
        // Clearing it removes the row rather than storing an empty string, so "has a
        // caption" stays a simple question to ask.
        await prisma.monthCaption.deleteMany({ where: { monthId, familyId } });
      } else {
        await prisma.monthCaption.upsert({
          where: { monthId_familyId: { monthId, familyId } },
          update: { text, updatedBy: locals.user.person.name },
          create: { monthId, familyId, text, updatedBy: locals.user.person.name }
        });
      }
    } catch (e) {
      console.log('Error saving month caption', e);
      return fail(500, { message: 'Could not save that caption. See logs.' });
    }

    return { success: true };
  }
};
