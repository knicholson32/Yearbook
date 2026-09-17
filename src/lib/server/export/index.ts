/**
 * Export jobs.
 *
 * An export of a year can be hundreds of full-resolution photos, most of which need a
 * decode and a re-encode, so it cannot run inside a request. Instead a job is registered,
 * the work runs in the background, and the admin polls for progress.
 *
 * Jobs live in memory: a restart loses them, which is the right trade for something that
 * is cheap to run again and meaningless to resume halfway.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '$lib/server/db';
import { getFileFolder } from '$lib/server/env';
import { getImageFolder } from '$lib/server/image';
import { toExportJpeg } from './jpeg';
import { ZipWriter, sanitizeSegment } from './zip';
import { MONTH_NAMES, familyLabel } from './naming';

export type ExportScope =
	| { kind: 'year'; year: number }
	| { kind: 'month'; year: number; month: number }
	| { kind: 'group'; year: number; month: number; familyId: string };

export type JobStatus = 'pending' | 'running' | 'done' | 'error';

export interface ExportJob {
	id: string;
	status: JobStatus;
	/** Human description of what is being exported, for the progress UI. */
	label: string;
	/** Photos to process. Known before the first one is converted. */
	total: number;
	/** Photos finished, whether converted or copied. */
	done: number;
	/** Of `done`, how many were already compliant and copied byte for byte. */
	passthrough: number;
	/** Photos that could not be converted. The export continues without them. */
	failed: { id: string; message: string }[];
	/** The file currently being worked on, so progress does not look stalled on a big one. */
	current: string | null;
	bytes: number;
	fileName: string;
	startedAt: number;
	finishedAt: number | null;
	error: string | null;
	/** Absolute path on disk. Never sent to the client. */
	filePath: string;
}

/** Exports older than this are swept on the next run. */
const KEEP_MS = 6 * 60 * 60 * 1000;

const jobs = new Map<string, ExportJob>();

const exportFolder = () => {
	const folder = path.join(getFileFolder(), 'exports');
	fs.mkdirSync(folder, { recursive: true });
	return folder;
};

/** Everything the client is allowed to see about a job. */
export const publicJob = (job: ExportJob) => ({
	id: job.id,
	status: job.status,
	label: job.label,
	total: job.total,
	done: job.done,
	passthrough: job.passthrough,
	failed: job.failed,
	current: job.current,
	bytes: job.bytes,
	fileName: job.fileName,
	error: job.error,
	elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt
});

export const getJob = (id: string): ExportJob | null => jobs.get(id) ?? null;

/**
 * Delete finished exports that have aged out, along with their jobs.
 *
 * Called when a new export starts rather than on a timer, so an idle deployment is not
 * holding a handle open for nothing.
 */
const sweep = () => {
	const cutoff = Date.now() - KEEP_MS;
	for (const [id, job] of jobs) {
		if (job.status === 'running' || job.status === 'pending') continue;
		if ((job.finishedAt ?? job.startedAt) > cutoff) continue;
		try {
			fs.unlinkSync(job.filePath);
		} catch (e) {
			// Already gone, or never written because the job failed early.
		}
		jobs.delete(id);
	}
};

/** The photos an export covers, in the order they will appear in the archive. */
const imagesForScope = async (scope: ExportScope) => {
	const monthWhere =
		scope.kind === 'year'
			? { month: { yearId: scope.year } }
			: { month: { yearId: scope.year, month: scope.month } };

	const familyWhere =
		scope.kind === 'group'
			? { uploadedBy: { person: { familyId: scope.familyId } } }
			: {};

	return await prisma.image.findMany({
		where: { ...monthWhere, ...familyWhere },
		orderBy: [{ month: { month: 'asc' } }, { sort: 'asc' }, { date: 'asc' }],
		select: {
			id: true,
			original: true,
			originalExtension: true,
			date: true,
			caption: true,
			month: { select: { month: true, yearId: true } },
			uploadedBy: {
				select: { person: { select: { family: { select: { id: true, people: { select: { name: true } } } } } } }
			}
		}
	});
};

const scopeLabel = (scope: ExportScope, groupName: string | null): string => {
	if (scope.kind === 'year') return `${scope.year}`;
	const month = `${MONTH_NAMES[scope.month - 1]} ${scope.year}`;
	return scope.kind === 'month' ? month : `${groupName ?? 'group'} -- ${month}`;
};

/**
 * Start an export and return its job immediately. The work continues in the background.
 *
 * @param scope what to export
 */
export const startExport = async (scope: ExportScope): Promise<ExportJob> => {
	sweep();

	const images = await imagesForScope(scope);

	const groupName =
		scope.kind === 'group'
			? familyLabel(
					images[0]?.uploadedBy.person.family.people ?? [],
					scope.familyId
				)
			: null;

	const label = scopeLabel(scope, groupName);
	const id = randomUUID();
	const fileName = `${sanitizeSegment(`Yearbook ${label}`)}.zip`;

	const job: ExportJob = {
		id,
		status: 'pending',
		label,
		total: images.length,
		done: 0,
		passthrough: 0,
		failed: [],
		current: null,
		bytes: 0,
		fileName,
		startedAt: Date.now(),
		finishedAt: null,
		error: null,
		filePath: path.join(exportFolder(), `${id}.zip`)
	};

	jobs.set(id, job);

	// Deliberately not awaited: the caller gets the job id straight back and polls.
	void run(job, images);

	return job;
};

type ScopedImage = Awaited<ReturnType<typeof imagesForScope>>[number];

const run = async (job: ExportJob, images: ScopedImage[]): Promise<void> => {
	job.status = 'running';

	const zip = new ZipWriter(job.filePath);

	try {
		for (const image of images) {
			const monthNumber = image.month?.month ?? 0;
			const yearNumber = image.month?.yearId ?? 0;
			const family = image.uploadedBy.person.family;

			// year > month > family group, so an extracted archive is browsable in Finder in
			// the same shape as the app itself.
			const folder = [
				sanitizeSegment(String(yearNumber)),
				sanitizeSegment(
					`${String(monthNumber).padStart(2, '0')} ${MONTH_NAMES[monthNumber - 1] ?? 'Unfiled'}`
				),
				sanitizeSegment(familyLabel(family.people, family.id))
			].join('/');

			// The capture date leads, so a directory listing is chronological. Metadata is
			// stripped during conversion, which makes the name the only place the date
			// survives. The id keeps two photos from the same second apart.
			const taken = new Date(image.date * 1000);
			const stamp = [
				taken.getUTCFullYear(),
				String(taken.getUTCMonth() + 1).padStart(2, '0'),
				String(taken.getUTCDate()).padStart(2, '0')
			].join('-');
			const caption = image.caption === null ? '' : ` ${image.caption}`;
			const name = sanitizeSegment(`${stamp}${caption} ${image.id.slice(0, 8)}`);

			job.current = `${name}.jpg`;

			try {
				const source = fs.readFileSync(path.join(getImageFolder(), image.original));
				const converted = await toExportJpeg(source);
				zip.add(`${folder}/${name}.jpg`, converted.data, taken);
				if (converted.passthrough) job.passthrough += 1;
			} catch (e) {
				// One unreadable original should not cost the admin the other 400 photos.
				job.failed.push({ id: image.id, message: e instanceof Error ? e.message : String(e) });
			}

			job.done += 1;
			job.bytes = zip.bytes;

			// Yield between photos so polling requests are actually served while a large
			// export runs. sharp releases the loop during its own work, but the loop above
			// is otherwise a tight synchronous chain of file reads.
			await new Promise((resolve) => setImmediate(resolve));
		}

		job.bytes = zip.close();
		job.current = null;
		job.status = 'done';
		job.finishedAt = Date.now();
	} catch (e) {
		zip.abort();
		job.status = 'error';
		job.error = e instanceof Error ? e.message : String(e);
		job.current = null;
		job.finishedAt = Date.now();
	}
};
