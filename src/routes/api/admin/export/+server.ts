import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { startExport, publicJob, type ExportScope } from '$lib/server/export';
import { isValidMonth, isValidYear } from '$lib/server/month';

/**
 * Begin an export. Returns the job straight away; the work runs in the background and the
 * caller polls `/api/admin/export/<id>`.
 */
export const POST = async ({ request, locals }) => {
  requireAdmin(locals.user);

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object') error(400, 'Expected a JSON body');

  const { kind, year, month, familyId } = body as Record<string, unknown>;

  if (typeof year !== 'number' || !isValidYear(year)) error(400, 'Bad year');

  let scope: ExportScope;
  if (kind === 'year') {
    scope = { kind: 'year', year };
  } else if (kind === 'month' || kind === 'group') {
    if (typeof month !== 'number' || !isValidMonth(month)) error(400, 'Bad month');
    if (kind === 'month') scope = { kind: 'month', year, month };
    else {
      if (typeof familyId !== 'string' || familyId.length === 0) error(400, 'Bad group');
      scope = { kind: 'group', year, month, familyId };
    }
  } else {
    error(400, 'Bad scope');
  }

  const job = await startExport(scope);
  return json(publicJob(job));
};
