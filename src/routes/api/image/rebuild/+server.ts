import { json } from '@sveltejs/kit';
import fs from 'node:fs';
import { prisma } from '$lib/server/db';
import { UPLOADER_SELECT, canManageImage } from '$lib/server/auth';
import { cropImages, getImageFolder } from '$lib/server/image';
import { detectFormat, detectHdr } from '$lib/server/image/format';

/**
 * Regenerate every derivative from the stored original.
 *
 * The originals are kept byte-for-byte, so this can rebuild in place whenever the pipeline
 * learns something new -- HDR gain map support, a format fix, a quality change -- without
 * anyone having to re-upload. Photos uploaded before a change keep serving stale
 * derivatives until this runs.
 *
 * POST body: `{ "ids": [...] }` to target specific photos, or omit for everything the
 * caller is allowed to touch.
 */
export const POST = async ({ request, locals }) => {
  if (locals.user === null) {
    return json({ status: 401, ok: false, message: 'Not signed in' }, { status: 401 });
  }

  let ids: string[] | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.ids)) ids = body.ids.map((i: unknown) => String(i));
  } catch (e) {
    // No body is fine: rebuild everything this user can manage.
  }

  const images = await prisma.image.findMany({
    where: ids === null ? {} : { id: { in: ids } },
    select: { id: true, original: true, full: true, i2048: true, i1024: true, i768: true, i512: true, ...UPLOADER_SELECT }
  });

  const rebuilt: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const image of images) {
    if (!canManageImage(locals.user, image.uploadedBy.person.familyId)) {
      skipped.push({ id: image.id, reason: 'not your group' });
      continue;
    }

    const originalPath = `${getImageFolder()}/${image.original}`;
    if (!fs.existsSync(originalPath)) {
      skipped.push({ id: image.id, reason: 'original missing on disk' });
      continue;
    }

    try {
      const raw = fs.readFileSync(originalPath);
      const format = detectFormat(raw);

      // Reuse the upload pipeline so there is exactly one definition of a derivative.
      const images_ = await cropImages(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, format, image.id);
      if (images_ === null) {
        skipped.push({ id: image.id, reason: 'could not decode' });
        continue;
      }

      // Names can change when a photo switches between AVIF and gain-map JPEG, so clear
      // out anything the rebuild replaced rather than leaving it orphaned on disk.
      const stale = [image.full, image.i2048, image.i1024, image.i768, image.i512].filter(
        (name): name is string =>
          typeof name === 'string' &&
          ![images_.full, images_.i2048, images_.i1024, images_.i768, images_.i512].includes(name)
      );
      for (const name of stale) {
        try { fs.unlinkSync(`${getImageFolder()}/${name}`); } catch (e) { /* already gone */ }
      }

      await prisma.image.update({
        where: { id: image.id },
        data: {
          full: images_.full,
          i2048: images_.i2048,
          i1024: images_.i1024,
          i768: images_.i768,
          i512: images_.i512,
          i256: images_.i256,
          i128: images_.i128,
          isHDR: detectHdr(raw, format)
        }
      });
      rebuilt.push(image.id);
    } catch (e) {
      console.log('Rebuild failed for', image.id, e);
      skipped.push({ id: image.id, reason: 'error, see logs' });
    }
  }

  return json({ status: 200, ok: true, rebuilt: rebuilt.length, skipped });
};
