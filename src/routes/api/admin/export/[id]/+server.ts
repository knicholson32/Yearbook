import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getJob, publicJob } from '$lib/server/export';

/** Progress for one export job. Polled by the dashboard while a run is in flight. */
export const GET = async ({ params, locals }) => {
  requireAdmin(locals.user);

  const job = getJob(params.id);
  // Jobs are in memory, so a restart mid-export legitimately loses one.
  if (job === null) error(404, 'No such export -- it may have expired or the server restarted');

  return json(publicJob(job));
};
