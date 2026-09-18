import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/auth';

/**
 * Files served to nobody in particular.
 *
 * A home-screen install fetches the touch icon and the manifest outside the browsing
 * session, so requiring an identity for them means the fetch comes back as a login page
 * rather than an image and the device draws its own grey letter tile instead. None of these
 * say anything about the family, so there is nothing to protect.
 *
 * Cloudflare Access has to be told the same thing -- a Bypass policy on these paths --
 * or the request never reaches us at all.
 */
const PUBLIC_FILES = new Set([
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable.png',
  '/manifest.webmanifest',
  // Chrome fetches these for the richer install dialog, the same way it fetches the icons.
  '/screenshot-wide.png',
  '/screenshot-narrow.png',
  '/robots.txt'
]);

export const handle: Handle = async ({ event, resolve }) => {
  if (!PUBLIC_FILES.has(event.url.pathname)) {
    // Resolve the session here rather than in `+layout.server.ts` so that form actions and
    // `+server.ts` endpoints -- neither of which run layout loads -- can authorize too.
    const { user, email } = await getSession(event);
    event.locals.user = user;
    event.locals.email = email;
  }

  return resolve(event, {
    preload: ({ type }) => type === 'font' || type === 'css' || type === 'js'
  });
};
