import { fileURLToPath } from 'node:url';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const TUNNEL_HOST = 'yearbook-dev.proute.org';

// When reached through the Cloudflare tunnel the page is https on the implicit port 443,
// so `location.port` is '' and Vite's HMR client builds `wss://<host>:/` -- a malformed
// URL, so the socket never connects. Without HMR, Vite cannot tell the browser to reload
// after it re-optimizes deps, so the page keeps modules pinned to a stale `?v=` hash
// (those 504 as "Outdated Optimize Dep") while new imports get the current one. That
// splits svelte's client runtime across two module instances, and hydration dies with
// "Cannot read properties of undefined (reading 'call')".
// Setting clientPort pins the socket URL to the tunnel's real port.
const viaTunnel = process.env.DEV_TUNNEL === '1';


// `@tailwindcss/vite` registers every file it scans via `addWatchFile` and then leans on
// Vite to invalidate the generated stylesheet when one of them changes. A file created
// *after* the last generation was never registered, so adding a component or route emits
// no invalidation and the stylesheet stays frozen -- every utility class on the new file
// silently does nothing until `app.css` itself is touched. The plugin's own `hotUpdate`
// hook won't cover this: it bails out for any extension another plugin owns as a JS
// module, which includes `.svelte`. So invalidate the stylesheet ourselves whenever a file
// appears or disappears. Edits to existing files already work, and are left alone.
const APP_CSS = fileURLToPath(new URL('./src/app.css', import.meta.url));

// Only files Tailwind actually scans may trigger this. Uploaded photos and SQLite's
// WAL/journal files land in `library/`, which is inside the project (and inside the dev
// container's /app mount), so an unscoped version of this reloads the page every time a
// photo is written -- killing the upload queue mid-flight.
const SRC_DIR = fileURLToPath(new URL('./src/', import.meta.url));
const SCANNED_BY_TAILWIND = /\.(html|js|jsx|ts|tsx|svelte|md|mdx)$/;

function tailwindInvalidateOnNewFiles() {
	return {
		name: 'tailwind-invalidate-on-new-files',
		apply: 'serve',
		enforce: 'post',
		hotUpdate(this: any, { type, file, timestamp }: { type: string; file: string; timestamp: number }) {
			if (type === 'update' || this.environment?.name !== 'client') return;
			if (!file.startsWith(SRC_DIR) || !SCANNED_BY_TAILWIND.test(file)) return;

			const graph = this.environment.moduleGraph;
			const modules = graph.getModulesByFile(APP_CSS);
			if (!modules?.size) return;

			for (const module of modules) {
				graph.invalidateModule(module, new Set(), timestamp, true);
			}
			this.environment.hot.send({ type: 'full-reload' });
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), tailwindInvalidateOnNewFiles(), sveltekit(), devtoolsJson()],
	server: {
		allowedHosts: [TUNNEL_HOST, 'yearbook-preview.proute.org'],
		watch: {
			// The photo store and the SQLite database live under the project root. Watching
			// them buys nothing and churns the watcher on every upload and every write.
			ignored: ['**/library/**', '**/generated/**']
		},
		...(viaTunnel && {
			hmr: {
				host: TUNNEL_HOST,
				protocol: 'wss',
				clientPort: 443
			}
		})
	}
});
