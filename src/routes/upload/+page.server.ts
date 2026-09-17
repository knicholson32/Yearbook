import { redirect } from '@sveltejs/kit';
import { getKnownYears, getPendingCount, getYearSummary, isValidYear } from '$lib/server/month';

export const load = async ({ url, locals }) => {
  const currentYear = new Date().getFullYear();

  // `?year=` drives the switcher so a given year stays shareable and survives a reload.
  const requested = Number.parseInt(url.searchParams.get('year') ?? '', 10);
  const year = isValidYear(requested) ? requested : currentYear;

  const [months, knownYears, pending] = await Promise.all([
    getYearSummary(year, locals.user),
    getKnownYears(locals.user),
    getPendingCount(year, locals.user)
  ]);

  // Always offer the year in view and the current year, even before either has any photos.
  const years = Array.from(new Set([...knownYears, currentYear, year])).sort((a, b) => a - b);

  return {
    year,
    years,
    months,
    pending,
    total: months.reduce((sum, m) => sum + m.count, 0)
  };
};
