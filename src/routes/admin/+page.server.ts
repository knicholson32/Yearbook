import { fail } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getKnownYears } from '$lib/server/month';
import { groupCounts, imageCount, peopleCounts, pendingCount } from '$lib/server/export/stats';
import { prisma } from '$lib/server/db';
import * as settings from "$lib/server/settings"

export const load = async ({ locals, url }) => {
  const user = requireAdmin(locals.user);

  const familyName = await settings.get('general.familyName');

  const years = await getKnownYears(user);
  // Default to the current year rather than the newest one on record: a stray photo filed
  // into a future year would otherwise make the dashboard open on an almost empty page.
  const requested = Number(url.searchParams.get('year'));
  const thisYear = new Date().getFullYear();
  const year = Number.isInteger(requested) && requested > 0
    ? requested
    : years.includes(thisYear)
      ? thisYear
      : (years.at(-1) ?? thisYear);

  // Per-month tallies for the year grid. One query rather than twelve.
  const months = await prisma.month.findMany({
    where: { yearId: year },
    select: { month: true, _count: { select: { images: true } } },
    orderBy: { month: 'asc' }
  });

  const yearRow = await prisma.year.findUnique({
    where: { id: year },
    select: { published: true, publishedAt: true, locked: true, title: true, photobookUrl: true }
  });

  const [total, people, groups, pending] = await Promise.all([
    imageCount(year),
    peopleCounts(year),
    groupCounts(year),
    pendingCount(year)
  ]);

  return {
    year,
    familyName,
    years,
    published: yearRow?.published ?? false,
    publishedAt: yearRow?.publishedAt?.getTime() ?? null,
    locked: yearRow?.locked ?? false,
    yearTitle: yearRow?.title ?? '',
    photobookUrl: yearRow?.photobookUrl ?? '',
    total,
    people,
    groups,
    pending,
    months: months.map((m) => ({ month: m.month, count: m._count.images }))
  };
};

export const actions = {
  /**
   * The link to a printed photo book of this year.
   *
   * Its own action rather than a field on the publish form: a book is usually ordered *after*
   * the year is finished, so the link has to be settable while the year is published -- and
   * everything on the publish form can only be submitted by publishing or unpublishing.
   */
  setPhotobook: async ({ request, locals }) => {
    const data = await request.formData();
    requireAdmin(locals.user);

    const year = Number(data.get('year'));
    if (!Number.isInteger(year)) return fail(400, { message: 'Bad year' });

    const raw = data.get('photobookUrl')?.toString().trim() ?? '';

    // Clearing it is a normal thing to want, so empty is allowed and means "no book".
    if (raw !== '') {
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch (e) {
        return fail(400, { message: 'That is not a full web address' });
      }
      // Scheme allow-list, not a pattern: this becomes an href, and `javascript:` in one is
      // how a link turns into a script.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return fail(400, { message: 'The link has to start with https://' });
      }
    }

    const existing = await prisma.year.findUnique({ where: { id: year }, select: { id: true } });
    if (existing === null) return fail(404, { message: 'That year has no photos yet' });

    await prisma.year.update({
      where: { id: year },
      data: { photobookUrl: raw === '' ? null : raw }
    });

    return { message: 'Saved' };
  },

  /**
   * Freeze a year's photos without publishing it, or reopen them.
   *
   * Gives the admin a stable set to build the printed book from while the yearbook is still
   * off the shelf. Independent of publishing -- see `$lib/server/yearbook/lock` -- so a year
   * that is locked and then published and unpublished stays locked.
   *
   * Upserted rather than refused when the row is missing: locking a year before anyone has
   * uploaded to it is odd, but harmless, and the row is what every lock check reads.
   */
  setLocked: async ({ request, locals }) => {
    const data = await request.formData();
    requireAdmin(locals.user);

    const year = Number(data.get('year'));
    if (!Number.isInteger(year)) return fail(400, { message: 'Bad year' });

    const locked = data.get('locked') === 'true';

    await prisma.year.upsert({
      where: { id: year },
      update: { locked },
      create: { id: year, locked }
    });

    return { success: true, locked };
  },

  /**
   * Put a year on the shelf, or take it off again.
   *
   * Publishing also freezes the year's photos. Unpublishing removes it from the Years tab
   * and reopens editing (unless it is separately locked) -- nothing is deleted and
   * `publishedAt` is kept, so a year that goes back up keeps the date it first appeared.
   */
  setPublished: async ({ request, locals }) => {
    const data = await request.formData();
    requireAdmin(locals.user);

    const year = Number(data.get('year'));
    if (!Number.isInteger(year)) return fail(400, { message: 'Bad year' });

    const published = data.get('published') === 'true';

    // Absent and empty mean different things. The title field is only on the form while the
    // year is unpublished, so a submission without it must leave the stored title alone --
    // reading a missing field as "" would erase the title every time a year is unpublished.
    const submitted = data.get('title');
    const title =
      submitted === null ? undefined : (submitted.toString().trim() || null);

    const existing = await prisma.year.findUnique({
      where: { id: year },
      select: { publishedAt: true }
    });

    if (existing === null) return fail(404, { message: 'That year has no photos yet' });

    await prisma.year.update({
      where: { id: year },
      data: {
        published,
        ...(title === undefined ? {} : { title }),
        // Set once, on the first publish, and left alone after that.
        publishedAt: published && existing.publishedAt === null ? new Date() : existing.publishedAt
      }
    });

    return { success: true, published };
  }
};
