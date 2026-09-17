import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import { requireAdmin } from '$lib/server/auth';
import { getJob } from '$lib/server/export';

/** Stream a finished archive. */
export const GET = async ({ params, locals, setHeaders }) => {
  requireAdmin(locals.user);

  const job = getJob(params.id);
  if (job === null) error(404, 'No such export');
  if (job.status !== 'done') error(409, `Export is ${job.status}`);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(job.filePath);
  } catch (e) {
    error(410, 'The archive has been cleaned up. Run the export again.');
  }

  setHeaders({
    'Content-Type': 'application/zip',
    'Content-Length': stat.size.toString(),
    // The name is built from the scope, so a folder of exports stays readable.
    'Content-Disposition': `attachment; filename="${job.fileName.replace(/"/g, '')}"`
  });

  return new Response(fs.createReadStream(job.filePath) as unknown as ReadableStream);
};
