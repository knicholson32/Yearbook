import { env } from '$env/dynamic/private';

/**
 * Where uploaded photos, exports and other generated files live.
 *
 * Read from the environment at runtime rather than through `$env/static/private`, which
 * inlines whatever the machine doing the *build* happened to have. Two things go wrong when
 * it is baked in: the image only builds if a developer's `.env` is sitting in the build
 * context (CI has none, so the build fails), and the path it captures cannot be changed
 * afterwards -- yet the folder is a volume the deployment mounts wherever it likes.
 *
 * Containers run from `/app` and write to the mounted `FILES_FOLDER`; running `pnpm dev` on
 * a developer's own machine writes to `FILES_FOLDER_LOCAL` inside the project instead, so
 * `PWD` is what tells the two apart.
 */
export const getFileFolder = () => {
  const inContainer = env.PWD === '/app';
  const variable = inContainer ? 'FILES_FOLDER' : 'FILES_FOLDER_LOCAL';
  const folder = inContainer ? env.FILES_FOLDER : env.FILES_FOLDER_LOCAL;

  // Fail loudly here rather than writing photos into a path built from `undefined`.
  if (folder === undefined || folder === '') {
    throw new Error(`${variable} is not set -- there is nowhere to read or write photos.`);
  }

  return folder;
};
