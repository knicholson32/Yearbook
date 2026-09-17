import { error } from '@sveltejs/kit';
import { neighbouringYears, publishedYearbook } from '$lib/server/yearbook';
import { isAdmin } from '$lib/server/auth';

export const load = async ({ params, locals }) => {
  const year = Number(params.year);
  if (!Number.isInteger(year)) error(404, 'No such yearbook');

  const book = await publishedYearbook(year);
  // `publishedYearbook` returns null for an unpublished year, so an unfinished one stays
  // as private as it was: there is no separate check to forget here.
  if (book === null) error(404, 'That yearbook has not been published');

  return { ...book, ...(await neighbouringYears(year)), admin: isAdmin(locals.user) };
};
