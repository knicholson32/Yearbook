import { applyAction, deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { ActionResult } from '@sveltejs/kit';

/**
 * Submit a form action with upload progress.
 *
 * `use:enhance` only tells you that a submission is in flight, not how far along it is,
 * which is not much comfort when a phone photo is going up over a home connection. XHR
 * still has the only upload progress event there is, so this posts by hand and then hands
 * the result back to SvelteKit exactly as `enhance` would.
 *
 * @param action the form action URL, e.g. `?/setPhoto`
 * @param body the form data to send
 * @param onProgress called with 0-100 as the bytes go out
 */
export const submitWithProgress = (
	action: string,
	body: FormData,
	onProgress: (percent: number) => void
): Promise<ActionResult> =>
	new Promise((resolve) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', action);
		// Without this SvelteKit answers with a redirect meant for a browser form post.
		xhr.setRequestHeader('x-sveltekit-action', 'true');

		xhr.upload.addEventListener('progress', (e) => {
			// Hold short of the end until the server answers: the bytes land well before the
			// resizes finish, and a bar sitting at 100% looks stuck.
			if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 99));
		});

		xhr.addEventListener('load', () => {
			onProgress(100);
			try {
				resolve(deserialize(xhr.responseText));
			} catch (e) {
				resolve({ type: 'error', error: new Error(`Unexpected response (${xhr.status})`) });
			}
		});

		xhr.addEventListener('error', () =>
			resolve({ type: 'error', error: new Error('Network error') })
		);

		xhr.send(body);
	});

/**
 * Apply an action result the way `use:enhance` does, so the page picks up whatever changed.
 * @returns the failure message, if the action reported one
 */
export const applyResult = async (result: ActionResult): Promise<string | null> => {
	if (result.type === 'failure') {
		return (result.data as { message?: string })?.message ?? 'That did not work';
	}
	if (result.type === 'error') {
		return result.error instanceof Error ? result.error.message : 'That did not work';
	}
	await applyAction(result);
	await invalidateAll();
	return null;
};
