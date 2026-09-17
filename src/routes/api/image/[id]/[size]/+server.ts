import { prisma } from '$lib/server/db';
import * as APIResponse from '$lib/types/responses';
import * as fs from 'node:fs';
import { getFileFolder } from '$lib/server/env';
import type { Buffer } from 'node:buffer';

// ------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------

import { MIME_BY_FORMAT, detectFormat, type ImageFormat } from '$lib/server/image/format';
import { getImageFolder, renderUncropped } from '$lib/server/image';

/**
 * The derivatives are all AVIF, but `original` keeps whatever was uploaded. Stored
 * extensions come from the bytes at upload, not the filename, so they can be trusted here.
 */
const contentTypeFor = (fileName: string): string => {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const normalized = (ext === 'jpeg' ? 'jpg' : ext === 'heif' ? 'heic' : ext) as ImageFormat;
  return MIME_BY_FORMAT[normalized] ?? 'application/octet-stream';
};

const streamImage = async (setHeaders: (headers: Record<string, string>) => void, fileName: string | null, id: string): Promise<Response> => {

  if (fileName === null) {
    const image = await prisma.image.findUnique({ where: { id }, select: { original: true, full: true, i2048: true, i1024: true } });
    if (image !== null) {
      if (image.i2048 !== null) fileName = image.i2048;
      else if (image.i1024 !== null) fileName = image.i1024;
      else if (image.full !== null) fileName = image.full;
      else fileName = image.original;
    }
  }

  if (typeof fileName !== 'string') return APIResponse._400({ message: 'File does not exist on disk. Invalid request.' });
  try {
    const filePath = `${getFileFolder()}/images/${fileName}`;
    const stat = fs.statSync(filePath);
    const readStream = fs.createReadStream(filePath);

    setHeaders({
      'Content-Type': contentTypeFor(fileName),
      'Cache-Control': 'max-age=60',
      'Content-Length': stat.size.toString()
    });


    // NOTE: This is NOT a correct typecast. This works, but typescript doesn't agree.
    // https://kit.svelte.dev/docs/routing#server
    return new Response(readStream as unknown as string);

  } catch (e) {
    return APIResponse._404();
  }
}

// ------------------------------------------------------------------------------------------
// Endpoints
// ------------------------------------------------------------------------------------------

export const GET = async ({ setHeaders, params, url}) => {
  const id = params.id;
  let size = params.size;
  const skipRecord = url.searchParams.get('no-record') === '1';

  // Check that the ID was actually submitted
  if (id === null || id === undefined) return APIResponse._400({ missingPaths: ['id'] });

  let exp: Buffer | null = null;

  // Switch based on pre-stored image size. We will try to use a pre-stored image before generating a new image size.
  if (size === 'uncropped') {
    // The full frame, whatever crop the derivatives were built with. Rendered on demand
    // rather than stored: only the cropper asks for it, and only now and then.
    const image = await prisma.image.findUnique({ where: { id }, select: { original: true } });
    if (image === null) return APIResponse._404();
    try {
      const raw = fs.readFileSync(`${getImageFolder()}/${image.original}`);
      const preview = await renderUncropped(raw);
      setHeaders({
        'Content-Type': 'image/jpeg',
        'Content-Length': preview.length.toString(),
        'Cache-Control': 'max-age=60'
      });
      return new Response(preview as unknown as BodyInit);
    } catch (e) {
      return APIResponse.serverError(e);
    }
  } else if (size === 'original') {
    const image = await prisma.image.findUnique({ where: { id }, select: { original: true } });
    if (image === null || image === undefined) return APIResponse._404();
    return await streamImage(setHeaders, image.original, id); 
  } else if (size === 'full') {
    const image = await prisma.image.findUnique({ where: { id }, select: { full: true } });
    if (image === null || image === undefined) return APIResponse._404();
    return await streamImage(setHeaders, image.full, id);
  } else if (size === '2048') {
    const image = await prisma.image.findUnique({ where: { id }, select: { i2048: true } });
    if (image === null || image === undefined) return APIResponse._404();
    return await streamImage(setHeaders, image.i2048, id);
  } else if (size === '1024') {
    const image = await prisma.image.findUnique({ where: { id }, select: { i1024: true } });
    if (image === null || image === undefined) return APIResponse._404();
    return await streamImage(setHeaders, image.i1024, id);
  } else if (size === '768') {
    const image = await prisma.image.findUnique({ where: { id }, select: { i768: true } });
    if (image === null || image === undefined) return APIResponse._404();
    return await streamImage(setHeaders, image.i768, id);
  } else if (size === '512') {
    const image = await prisma.image.findUnique({ where: { id }, select: { i512: true } });
    if (image === null || image === undefined) return APIResponse._404();
    return await streamImage(setHeaders, image.i512, id);
  } else if (size === '256') {
    const image = await prisma.image.findUnique({ where: { id }, select: { i256: true } });
    if (image === null || image === undefined) return APIResponse._404();
    exp = image.i256 as unknown as Buffer<ArrayBufferLike>;
  } else if (size === '128') {
    const image = await prisma.image.findUnique({ where: { id }, select: { i128: true } });
    if (image === null || image === undefined) return APIResponse._404();
    exp = image.i128 as unknown as Buffer<ArrayBufferLike>;
  } else {
    return APIResponse._400({missingURLParams: ['size'], message: 'Invalid size param'});
  }

  // Check that the image buffer was populated.
  if (exp === null) return APIResponse.serverError('Image buffer was never populated');

  // Return the image
  try {
    setHeaders({
      // Sniffed, not assumed: the small sizes are AVIF for ordinary photos but gain-map
      // JPEG for HDR ones, and mislabelling makes the browser refuse to render them.
      'Content-Type': MIME_BY_FORMAT[detectFormat(exp)],
      'Content-Length': exp.length.toString(),
      'Cache-Control': 'max-age=60'
    });
    return new Response(exp as unknown as BodyInit);
  } catch (e) {
    return APIResponse.serverError(e);
  }
};