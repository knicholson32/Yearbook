// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { SessionUser } from '$lib/server/auth';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** The signed-in user, or null if the email has no account yet. */
			user: SessionUser | null;
			/** The email Cloudflare Access authenticated, or null when unauthenticated. */
			email: string | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
