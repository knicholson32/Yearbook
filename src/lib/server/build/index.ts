import fs from 'node:fs';
import { env } from '$env/dynamic/private';

/**
 * What this copy of the app is: its versions, and where it came from.
 *
 * Read once when the server starts rather than per request -- it is a file read and a
 * handful of environment lookups, and none of it can change while the process is alive.
 *
 * The git and build fields are only populated in a built image, where the Dockerfile turns
 * the build arguments into environment variables. Running from source they are simply
 * absent, and the dialog says so rather than inventing a value.
 */

const packageJsonPath = env.NODE_ENV === 'development' ? `${env.PWD}/package.json` : '/app/package.json';

const manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; version?: string } =
  (() => {
    try {
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (e) {
      console.error('Could not read package.json for build info:', e);
      return {};
    }
  })();

/** The declared range for a package, with the `^`/`~` stripped. */
const version = (pkg: string): string | null => {
  const range = manifest.dependencies?.[pkg] ?? manifest.devDependencies?.[pkg];
  return range === undefined ? null : range.replace(/^[\^~]/, '');
};

const nonEmpty = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

export const buildInfo = {
  /** Seconds since the epoch, stamped by the Docker build. */
  builtAt: Number(env.BUILD_TIMESTAMP) > 0 ? Number(env.BUILD_TIMESTAMP) : null,
  commit: nonEmpty(env.GIT_COMMIT),
  ref: nonEmpty(env.GIT_REF),
  image: nonEmpty(env.REGISTRY_IMAGE),
  // `process.version` is the truth at runtime; NODE_VERSION is only what the image asked for.
  node: process.version.replace(/^v/, ''),
  parentImage: nonEmpty(env.PARENT_IMAGE),
  packaged: env.YEARBOOK_PACKAGED === '1',
  packages: {
    svelte: version('svelte'),
    kit: version('@sveltejs/kit'),
    vite: version('vite'),
    tailwind: version('tailwindcss'),
    prisma: version('prisma'),
    sharp: version('sharp')
  }
} as const;

export type BuildInfo = typeof buildInfo;
