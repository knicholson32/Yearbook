import { json } from '@sveltejs/kit';
import * as APIResponse from '$lib/types/responses';
import { prisma } from '$lib/server/db';
import { uploadImage } from '$lib/server/image';
import { ensureMonth, isValidMonth, isValidYear } from '$lib/server/month';
import { findDuplicate } from '$lib/server/image/duplicates';
import { LOCKED_MESSAGE, isYearLocked } from '$lib/server/yearbook/lock';

/** Matches the `maxMB` the image pipeline enforces. */
const MAX_MB = 25;

/**
 * Upload one photo into a month.
 *
 * One file per request rather than a batch, so the client can report per-file progress and
 * a single bad photo doesn't take the whole drop down with it.
 */
export const POST = async ({ request, locals }) => {
  // Read the body before authorising. Answering a half-sent upload makes the server hang
  // up mid-stream, which surfaces as `Error: aborted` rather than the 401 we meant. The
  // size cap below still bounds what an unauthenticated caller can push.
  const data = await request.formData();
  if (locals.user === null) {
    return json({ status: 401, ok: false, message: 'Not signed in' }, { status: 401 });
  }

  const file = data.get('image');
  const year = Number.parseInt(data.get('year')?.toString() ?? '', 10);
  // Uploading to a year rather than a month: file by capture date where we can, and park
  // anything we cannot place so it can be sorted by hand instead of guessed at.
  const monthRaw = data.get('month')?.toString() ?? '';
  const byCaptureDate = monthRaw === '' || monthRaw === 'auto';
  const month = Number.parseInt(monthRaw, 10);
  // The browser knows when the file was last written; it beats "now" as a stand-in for
  // when the photo was taken, and only affects ordering within the month.
  const lastModified = Number.parseInt(data.get('lastModified')?.toString() ?? '', 10);

  if (!(file instanceof File)) return APIResponse._400({ missingBodyParams: ['image'] });
  if (!isValidYear(year)) return APIResponse._400({ message: 'Invalid year' });
  if (!byCaptureDate && !isValidMonth(month)) {
    return APIResponse._400({ message: 'Invalid month' });
  }
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    return APIResponse._400({ message: `${file.name} is not an image` });
  }

  // Checked before any work is done: a published year is frozen, so there is no point
  // decoding a 10MB HEIC only to refuse it.
  if (await isYearLocked(year)) {
    return json({ status: 423, ok: false, message: LOCKED_MESSAGE }, { status: 423 });
  }

  const extension = file.name.includes('.') ? file.name.split('.').pop()! : 'jpg';
  const fallbackDate = Number.isNaN(lastModified) ? undefined : Math.floor(lastModified / 1000);

  // When filing by capture date we need the photo's own EXIF, which only exists once it
  // has been read -- so upload it unfiled, then place it.
  let monthId: string | null = null;
  let sort = 0;
  if (!byCaptureDate) {
    monthId = await ensureMonth(year, month);
    const last = await prisma.image.findFirst({
      where: { monthId },
      orderBy: { sort: 'desc' },
      select: { sort: true }
    });
    sort = (last?.sort ?? -1) + 1;
  }

  // Set by the "Upload anyway" button, after the uploader has seen the warning.
  const allowDuplicate = data.get('allowDuplicate')?.toString() === 'true';

  // Nothing is committed until the hash clears this: the veto runs inside the pipeline, so a
  // refused duplicate leaves no row and no files rather than being stored and then removed.
  let duplicate: Awaited<ReturnType<typeof findDuplicate>> = null;

  const result = await uploadImage(file, extension, {
    userId: locals.user.id,
    monthId,
    date: fallbackDate,
    sort,
    maxMB: MAX_MB,
    checkDuplicate: allowDuplicate
      ? undefined
      : async (hash) => {
          duplicate = await findDuplicate(hash, '', locals.user!.person.familyId);
          return duplicate;
        }
  });

  // 409: the upload was understood and deliberately not stored. The client keeps the file so
  // it can offer to send it again with `allowDuplicate`.
  if (!result.success && duplicate !== null) {
    return json(
      {
        status: 409,
        ok: false,
        message: 'Already in the yearbook',
        duplicate,
        // The client has the file but often cannot display it -- a HEIC has no
        // browser-renderable form -- so the thumbnail comes from the server.
        preview: result.preview ?? null
      },
      { status: 409 }
    );
  }

  if (!result.success) return json({ status: 400, ok: false, message: result.message }, { status: 400 });

  // Only reachable when the uploader chose "Upload anyway", so the responses below can still
  // report what it duplicated. A first-time upload never gets here with a match.
  const accepted = allowDuplicate
    ? await (async () => {
        const stored = await prisma.image.findUnique({
          where: { id: result.id },
          select: { hash: true }
        });
        return stored === null
          ? null
          : await findDuplicate(stored.hash, result.id, locals.user!.person.familyId);
      })()
    : null;

  if (!byCaptureDate) {
    // Landed in the month the user navigated to. Whether that matches the photo's own
    // capture date is worked out when the page loads, so a refiled or long-since-uploaded
    // photo is flagged the same way a fresh one is.
    return json({ status: 200, ok: true, id: result.id, filed: 'month', year, month, duplicate: accepted });
  }

  // Year upload: place it by its own capture date when that lands inside this year.
  const stored = await prisma.image.findUnique({
    where: { id: result.id },
    select: { date: true }
  });
  const taken = stored === null ? null : new Date(stored.date * 1000);
  const takenYear = taken?.getUTCFullYear();
  const takenMonth = taken === null ? null : taken.getUTCMonth() + 1;

  // Only file automatically when the photo itself says when it was taken. Falling back to
  // the file's modification time would quietly drop undated photos into whatever month the
  // upload happened in, which is worse than asking.
  if (result.datedFromExif && takenYear === year && takenMonth !== null) {
    const target = await ensureMonth(year, takenMonth);
    const last = await prisma.image.findFirst({
      where: { monthId: target },
      orderBy: { sort: 'desc' },
      select: { sort: true }
    });
    await prisma.image.update({
      where: { id: result.id },
      data: { monthId: target, sort: (last?.sort ?? -1) + 1 }
    });
    return json({ status: 200, ok: true, id: result.id, filed: 'month', year, month: takenMonth, duplicate: accepted });
  }

  // Undated, or taken outside this year: park it for manual sorting.
  await prisma.year.upsert({ where: { id: year }, update: {}, create: { id: year } });
  await prisma.image.update({ where: { id: result.id }, data: { pendingForId: year } });
  return json({ status: 200, ok: true, id: result.id, filed: 'pending', year, duplicate: accepted });
};
