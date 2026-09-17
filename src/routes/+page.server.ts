import { publishedYears } from '$lib/server/yearbook';
import { isAdmin } from '$lib/server/auth';
import * as settings from '$lib/server/settings';

export const load = async ({ locals }) => {

  const set = await settings.getMany('general.familyName', 'years.background');

  return {
    years: await publishedYears(),
    familyName: set['general.familyName'],
    background: set['years.background'],
    // Only to offer a way back to the admin area when the shelf is empty.
    admin: isAdmin(locals.user)
  };
};
