import { redirect } from '@sveltejs/kit';
import { getKnownYears, getPendingCount, getYearSummary, isValidYear } from '$lib/server/month';
import * as settings from '$lib/server/settings';
import { yearLockReason } from '$lib/server/yearbook/lock';

export const load = async ({ url, locals }) => {
  const currentYear = new Date().getFullYear();

  // `?year=` drives the switcher so a given year stays shareable and survives a reload.
  const requested = Number.parseInt(url.searchParams.get('year') ?? '', 10);
  const year = isValidYear(requested) ? requested : currentYear;

  const [months, knownYears, pending, photosPerMonth, lockReason] = await Promise.all([
    getYearSummary(year, locals.user),
    getKnownYears(locals.user),
    getPendingCount(year, locals.user),
    settings.get('upload.photosPerMonth'),
    yearLockReason(year)
  ]);

  // Always offer the year in view and the current year, even before either has any photos.
  const years = Array.from(new Set([...knownYears, currentYear, year])).sort((a, b) => a - b);

  return {
    year,
    years,
    months,
    pending,
    /** The admin's target per group per month. A month at or past it is marked done. */
    photosPerMonth,
    lockReason,
    total: months.reduce((sum, m) => sum + m.count, 0)
  };
};
