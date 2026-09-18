import { redirect } from '@sveltejs/kit';
import { buildInfo } from '$lib/server/build';

export const load = async ({ locals, url }) => {
  const { user, email } = locals;

  if (!url.pathname.startsWith('/new-user') && user === null) redirect(307, '/new-user');

  return {
    user,
    email,
    // Constant for the life of the process; shown in the About dialog.
    build: buildInfo
  };
};
