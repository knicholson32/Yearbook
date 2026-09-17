import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  // Resolve the session here rather than in `+layout.server.ts` so that form actions and
  // `+server.ts` endpoints -- neither of which run layout loads -- can authorize too.
  const { user, email } = await getSession(event.request);
  event.locals.user = user;
  event.locals.email = email;

  return resolve(event, {
    preload: ({ type }) => type === 'font' || type === 'css' || type === 'js'
  });
};
