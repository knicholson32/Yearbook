import { error } from '@sveltejs/kit';
import { requireAdmin, canManageImage } from '$lib/server/auth';
import { parseYearMonth } from '$lib/server/month';
import { peopleCounts } from '$lib/server/export/stats';
import { familyLabel } from '$lib/server/export/naming';
import { photoActions } from '$lib/server/image/photoActions';
import { prisma } from '$lib/server/db';
import { isYearLocked } from '$lib/server/yearbook/lock';

export const load = async ({ params, locals }) => {
  const user = requireAdmin(locals.user);

  const parsed = parseYearMonth(params.year, params.month);
  if (parsed === null) error(404, 'No such month');
  const { year, month } = parsed;

  // Published years are frozen for admins too; unpublishing is the way back in.
  const locked = await isYearLocked(year);

  // Unscoped on purpose: this is the view that exists to see across every family. The
  // group's own month page still uses `visibleImagesWhere` and shows only their photos.
  const images = await prisma.image.findMany({
    where: { month: { yearId: year, month } },
    orderBy: [{ sort: 'asc' }, { date: 'asc' }],
    select: {
      id: true,
      caption: true,
      date: true,
      hex: true,
      isHDR: true,
      width: true,
      height: true,
      latitude: true,
      longitude: true,
      altitude: true,
      make: true,
      model: true,
      lens: true,
      dateWarningDismissed: true,
      includes: { select: { id: true, name: true } },
      uploadedBy: {
        select: {
          id: true,
          gravatarHash: true,
          person: {
            select: {
              id: true,
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

  // Everyone, and every group -- an admin tagging another family's photo needs that
  // family's people in the picker, which the group-scoped month page never offers.
  const [people, familyRows] = await Promise.all([
    prisma.person.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.family.findMany({ select: { id: true, people: { select: { name: true } } } })
  ]);

  const families = familyRows.map((family) => ({
    id: family.id,
    label: familyLabel(family.people, family.id)
  }));

  /** The shape PhotoDialog expects, plus who uploaded it. */
  const forDialog = (image: (typeof images)[number]) => {
    const taken = new Date(image.date * 1000);
    const capturedYear = taken.getUTCFullYear();
    const capturedMonth = taken.getUTCMonth() + 1;
    const person = image.uploadedBy.person;

    return {
      id: image.id,
      caption: image.caption,
      date: image.date,
      hex: image.hex,
      isHDR: image.isHDR,
      width: image.width,
      height: image.height,
      latitude: image.latitude,
      longitude: image.longitude,
      altitude: image.altitude,
      make: image.make,
      model: image.model,
      lens: image.lens,
      includes: image.includes,
      capturedYear,
      capturedMonth,
      misfiled:
        !image.dateWarningDismissed && (capturedYear !== year || capturedMonth !== month),
      // Always true for an admin, but read through the same helper the rest of the app
      // uses rather than hardcoded, so one place decides who may edit what.
      canManage: !locked && canManageImage(user, person.family.id),
      uploader: {
        name: person.name,
        personId: person.id,
        imageId: person.imageId,
        gravatarHash: image.uploadedBy.gravatarHash,
        version: person.profileImage?.updatedAt.getTime() ?? null
      }
    };
  };

  // Grouped here rather than in a query per family, and kept in a stable order so the page
  // does not reshuffle between loads.
  const byGroup = new Map<string, { id: string; label: string; images: typeof images }>();
  for (const image of images) {
    const family = image.uploadedBy.person.family;
    const existing = byGroup.get(family.id);
    if (existing === undefined) {
      byGroup.set(family.id, {
        id: family.id,
        label: familyLabel(family.people, family.id),
        images: [image]
      });
    } else {
      existing.images.push(image);
    }
  }

  // Every group's note about this month. Normally a group only ever sees its own -- this is
  // the admin view, which is the one place they are read together.
  //
  // A caption can exist for a group with no photos here: writing one creates the month row on
  // demand, so a group can describe a month before filing anything into it. Those groups are
  // folded in below rather than dropped, or the caption would be written and then invisible.
  const captions = await prisma.monthCaption.findMany({
    where: { month: { yearId: year, month } },
    select: {
      familyId: true,
      text: true,
      updatedAt: true,
      updatedBy: true,
      family: { select: { id: true, people: { select: { name: true } } } }
    }
  });

  for (const caption of captions) {
    if (byGroup.has(caption.familyId)) continue;
    byGroup.set(caption.familyId, {
      id: caption.familyId,
      label: familyLabel(caption.family.people, caption.familyId),
      images: []
    });
  }

  // Avatars for the group headings. Keyed by name, which is what `familyLabel` is built
  // from, so the row of faces matches the label beside it.
  const groupMembers = await prisma.person.findMany({
    where: { familyId: { in: [...byGroup.keys()] } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      familyId: true,
      imageId: true,
      profileImage: { select: { updatedAt: true } }
    }
  });

  const groups = [...byGroup.values()]
    .map((group) => ({
      id: group.id,
      label: group.label,
      count: group.images.length,
      caption: (() => {
        const own = captions.find((entry) => entry.familyId === group.id);
        if (own === undefined || own.text.trim() === '') return null;
        return {
          text: own.text,
          updatedAt: own.updatedAt.getTime(),
          updatedBy: own.updatedBy
        };
      })(),
      members: groupMembers
        .filter((member) => member.familyId === group.id)
        .map((member) => ({
          id: member.id,
          name: member.name,
          imageId: member.imageId,
          version: member.profileImage?.updatedAt.getTime() ?? null
        })),
      // Who appears in this group's photos, with counts, so the per-group block carries the
      // same breakdown the month and year levels do.
      people: [
        ...group.images
          .flatMap((image) => image.includes)
          .reduce((acc, person) => {
            acc.set(person.id, { name: person.name, count: (acc.get(person.id)?.count ?? 0) + 1 });
            return acc;
          }, new Map<string, { name: string; count: number }>())
      ]
        .map(([id, entry]) => ({ id, ...entry }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      images: group.images.map(forDialog)
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    year,
    month,
    locked,
    total: images.length,
    hdrCount: images.filter((image) => image.isHDR).length,
    // Already carries each person's picture.
    people: await peopleCounts(year, month),
    groups,
    families,
    pickerPeople: people
  };
};

/**
 * Form actions do not run `load`, so the admin check in the loader above does not protect
 * them. Each handler is wrapped instead -- otherwise `POST /admin/.../?/details` answers as
 * a normal route for anyone signed in, which both leaks that the admin area exists and
 * leans entirely on `canManageImage` to be the only thing standing in the way.
 */
export const actions = Object.fromEntries(
  Object.entries(photoActions).map(([name, handler]) => [
    name,
    async (event: Parameters<typeof handler>[0]) => {
      requireAdmin(event.locals.user);
      return await handler(event);
    }
  ])
) as typeof photoActions;
