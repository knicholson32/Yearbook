<script lang="ts">
  import { ImagePlus, Loader2, TriangleAlert, Copy } from 'lucide-svelte';
  import { basicPlural } from '$lib/helpers';

  interface Props {
    year: number;
    /** Omit to file by each photo's own capture date, parking what cannot be placed. */
    month?: number | null;
    /** Called once every file in a drop has finished, so the page can reload its data. */
    onuploaded: () => void;
  }

  let { year, month = null, onuploaded }: Props = $props();

  interface Duplicate {
    /** Only used to show the thumbnail; there is no link through to the photo. */
    id: string;
    exact: boolean;
    uploader: string;
    sameGroup: boolean;
    filed: string | null;
    caption: string | null;
    people: string[];
  }

  type Job = {
    name: string;
    progress: number;
    error: string | null;
    duplicate: Duplicate | null;
    /** The id this upload was stored under, so the warning can show it beside the match. */
    uploadedId: string | null;
    /** Held back as a duplicate: understood, and deliberately not stored. */
    skipped: boolean;
    /** `data:` thumbnail of the held-back photo, rendered by the server. */
    preview: string | null;
  };

  let jobs = $state<Job[]>([]);

  /**
   * Duplicate warnings outlive the progress list.
   *
   * A clean run clears its jobs after a beat, which would take the warnings with it before
   * anyone had read them -- so they are kept here until the next drop or until dismissed.
   */
  interface HeldBack {
    name: string;
    /** Kept so "Upload anyway" can send the very same bytes without a re-pick. */
    file: File;
    /**
     * `data:` thumbnail from the server.
     *
     * Not built from the local file: the browser cannot decode a HEIC, which is most of what
     * a phone uploads, so pointing an `<img>` at it renders nothing. The server has already
     * decoded the photo by the time it refuses it, so its own thumbnail comes back instead.
     */
    preview: string | null;
    duplicate: Duplicate;
    /** Set once the uploader overrides the warning, so the button cannot be pressed twice. */
    sending: boolean;
  }

  let duplicates = $state<HeldBack[]>([]);
  let dragging = $state(false);
  let picker = $state<HTMLInputElement | null>(null);

  const busy = $derived(jobs.some((j) => j.error === null && j.progress < 100));
  const failed = $derived(jobs.filter((j) => j.error !== null));

  /**
   * Upload one file, reporting progress.
   *
   * XHR rather than fetch because fetch still has no upload progress event, and a phone
   * photo over a home connection is slow enough that a progress bar is worth the API.
   */
  const send = (file: File, job: Job, allowDuplicate = false) =>
    new Promise<void>((resolve) => {
      const body = new FormData();
      body.set('image', file);
      body.set('year', year.toString());
      // An empty month tells the server to file by capture date.
      body.set('month', month === null ? '' : month.toString());
      body.set('lastModified', file.lastModified.toString());
      // Only sent once the uploader has seen the warning and chosen to go ahead.
      if (allowDuplicate) body.set('allowDuplicate', 'true');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.addEventListener('progress', (e) => {
        // Hold at 99 until the server answers -- the bytes are sent well before the
        // resizes finish, and a bar that sits at 100% looks stuck.
        if (e.lengthComputable) job.progress = Math.round((e.loaded / e.total) * 99);
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          job.progress = 100;
          try {
            const body = JSON.parse(xhr.responseText);
            if (typeof body.id === 'string') job.uploadedId = body.id;
            if (body.duplicate != null) job.duplicate = body.duplicate as Duplicate;
          } catch (e) { /* a success without a parseable body still counts as uploaded */ }
        } else if (xhr.status === 409) {
          // Refused as a duplicate. Deliberately not an error: nothing was stored, and the
          // file is kept so it can be sent again if the uploader wants it anyway.
          try {
            const body = JSON.parse(xhr.responseText);
            job.duplicate = body.duplicate as Duplicate;
            job.preview = typeof body.preview === 'string' ? body.preview : null;
            job.skipped = true;
          } catch (e) {
            job.error = 'Upload failed (409)';
          }
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            message = JSON.parse(xhr.responseText).message ?? message;
          } catch (e) { /* response wasn't JSON; keep the status message */ }
          job.error = message;
        }
        resolve();
      });

      xhr.addEventListener('error', () => {
        job.error = 'Network error';
        resolve();
      });

      xhr.send(body);
    });

  const upload = async (files: FileList | File[] | null) => {
    if (files === null) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    jobs = list.map((file) => ({
      name: file.name,
      progress: 0,
      error: null,
      duplicate: null,
      uploadedId: null,
      skipped: false,
      preview: null
    }));

    // Sequential so the month keeps the order they were picked in, and so a large drop
    // doesn't start a dozen simultaneous sharp pipelines on the server. Each send is
    // guarded: one photo that blows up must not abandon the ones queued behind it.
    for (let i = 0; i < list.length; i++) {
      try {
        await send(list[i], jobs[i]);
      } catch (e) {
        console.error('Upload failed', list[i].name, e);
        jobs[i].error = e instanceof Error ? e.message : 'Upload failed';
      }
    }

    onuploaded();

    duplicates = jobs
      .map((job, i) => ({ job, file: list[i] }))
      .filter(({ job }) => job.duplicate !== null && job.skipped)
      .map(({ job, file }) => ({
        name: job.name,
        file,
        preview: job.preview,
        duplicate: job.duplicate as Duplicate,
        sending: false
      }));

    // Leave failures on screen; clear a clean run after a beat.
    if (!jobs.some((j) => j.error !== null)) setTimeout(() => (jobs = []), 600);
  };

  /**
   * Send a held-back photo again with the duplicate check waived.
   *
   * The original `File` is still in memory, so nothing has to be re-picked -- and because
   * the first attempt stored nothing, this is a first upload rather than an undo.
   */
  const uploadAnyway = async (entry: HeldBack) => {
    entry.sending = true;

    const job: Job = {
      name: entry.name,
      progress: 0,
      error: null,
      duplicate: null,
      uploadedId: null,
      skipped: false,
      preview: null
    };
    jobs = [job];

    await send(entry.file, job, true);

    duplicates = duplicates.filter((d) => d.name !== entry.name);
    onuploaded();

    if (job.error === null) setTimeout(() => (jobs = []), 600);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragging = false;
    upload(e.dataTransfer?.files ?? null);
  };
</script>

<div
  role="region"
  aria-label="Upload photos"
  data-testid="dropzone"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
  class="rounded-xl border-2 border-dashed p-6 text-center transition {dragging
    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
    : 'border-gray-300 dark:border-white/15'}"
>
  <input
    bind:this={picker}
    data-testid="dropzone-input"
    type="file"
    multiple
    accept="image/*,.heic,.heif"
    class="hidden"
    onchange={async (e) => {
      const input = e.currentTarget;
      await upload(input.files);
      // Reset only once every file has been read, so re-picking the same photo works
      // without the reset racing the queue still reading `input.files`.
      input.value = '';
    }}
  />

  {#if jobs.length === 0}
    <ImagePlus class="mx-auto size-8 text-gray-400" />
    <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
      Drag photos here, or
      <button type="button" data-testid="dropzone-browse" onclick={() => picker?.click()} class="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
        browse
      </button>
    </p>
    <p class="mt-1 text-xs text-gray-400">
      JPEG, PNG, HEIC &middot; up to 25&nbsp;MB each
      {#if month === null}&middot; sorted into months by capture date{/if}
    </p>
  {:else}
    <div class="space-y-2 text-left">
      {#each jobs as job (job.name)}
        <div>
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="truncate text-gray-700 dark:text-gray-300">{job.name}</span>
            {#if job.error !== null}
              <span class="shrink-0 text-red-600 dark:text-red-400">{job.error}</span>
            {:else if job.progress === 100}
              <span class="shrink-0 text-green-600 dark:text-green-400">Done</span>
            {:else}
              <span class="shrink-0 text-gray-400">{job.progress}%</span>
            {/if}
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
            <div
              class="h-full rounded-full transition-[width] {job.error !== null ? 'bg-red-500' : 'bg-indigo-500'}"
              style="width: {job.error !== null ? 100 : job.progress}%"
            ></div>
          </div>
        </div>
      {/each}
    </div>

    {#if busy}
      <p class="mt-3 flex items-center justify-center gap-2 text-xs text-gray-500">
        <Loader2 class="size-3 animate-spin" /> Processing&hellip;
      </p>
    {:else if failed.length > 0}
      <p class="mt-3 flex items-center justify-center gap-2 text-xs text-red-600 dark:text-red-400">
        <TriangleAlert class="size-3" />
        {failed.length} {basicPlural('photo', failed.length)} failed
        <button type="button" onclick={() => (jobs = [])} class="font-semibold underline">Dismiss</button>
      </p>
    {/if}
  {/if}
</div>

<!-- Outside the dropzone: these are about what is already in the yearbook, not about the
     upload, and they stay put after the progress list has cleared itself. -->
{#if duplicates.length > 0}
  <ul class="mt-3 space-y-2" data-testid="duplicate-warnings">
    {#each duplicates as entry (entry.name)}
      <li
        class="rounded-xl bg-amber-50 p-3 text-left outline outline-amber-600/20 sm:px-4 dark:bg-amber-400/10 dark:outline-amber-400/20"
        data-testid="duplicate-warning"
        data-duplicate-of={entry.duplicate.id}
      >
        <!-- Wide rather than tall once there is room: the photographs take the left,
             everything written takes the right. Stacked on a phone, where there is no width
             to put them side by side. -->
        <div class="sm:flex sm:items-start sm:gap-5">
          <!-- Both photos at the same size, which is what makes a comparison possible --
               a larger "already there" beside a thumbnail of your own would show a
               difference in the frames rather than in the pictures. -->
          <div class="flex shrink-0 gap-3">
            {#if entry.preview !== null}
              <figure>
                <img
                  src={entry.preview}
                  alt="The one you picked"
                  data-testid="duplicate-preview-new"
                  class="preview rounded-md bg-amber-900/5 object-contain outline outline-amber-600/25 dark:bg-black/20"
                />
                <figcaption class="mt-1 text-[11px] text-amber-800/80 dark:text-amber-200/60">
                  Yours
                </figcaption>
              </figure>
            {/if}

            <figure>
              <!-- `sizes` is the width the photo actually renders at -- height 9rem times a
                   landscape ratio -- not the `max-width` cap. A 2x screen then asks for ~384px
                   and gets the 512, which is the point: a difference has to be visible. -->
              <img
                src="/api/image/{entry.duplicate.id}/512"
                srcset="/api/image/{entry.duplicate.id}/256 256w, /api/image/{entry.duplicate.id}/512 512w"
                sizes="(min-width: 40rem) 12rem, 8rem"
                alt="Already in the yearbook"
                data-testid="duplicate-preview-existing"
                class="preview rounded-md bg-amber-900/5 object-contain outline outline-amber-600/25 dark:bg-black/20"
              />
              <figcaption class="mt-1 text-[11px] text-amber-800/80 dark:text-amber-200/60">
                Already there
              </figcaption>
            </figure>
          </div>

          <div class="mt-3 min-w-0 grow sm:mt-0">
            <p class="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
              <Copy class="mt-0.5 size-4 shrink-0" />
              <span>
                <span class="font-mono text-xs">{entry.name}</span>
                {entry.duplicate.exact
                  ? 'is already in the yearbook, so it was not uploaded'
                  : 'looks like one already in the yearbook, so it was not uploaded'}
              </span>
            </p>

            <div class="mt-1.5 space-y-0.5 text-sm text-amber-800 dark:text-amber-200/80">
              <p>
                <!-- Naming the group matters: "someone you have never heard of already has
                     this" is confusing without it. -->
                Uploaded by <strong class="font-semibold">{entry.duplicate.uploader}</strong>
                {#if !entry.duplicate.sameGroup}<span class="text-xs">(another group)</span>{/if}
                {#if entry.duplicate.filed !== null}
                  to <strong class="font-semibold">{entry.duplicate.filed}</strong>
                {:else}
                  &middot; not filed into a month yet
                {/if}
              </p>

              {#if entry.duplicate.caption !== null && entry.duplicate.caption.trim() !== ''}
                <p class="italic">&ldquo;{entry.duplicate.caption}&rdquo;</p>
              {/if}

              {#if entry.duplicate.people.length > 0}
                <p>Tagged: {entry.duplicate.people.join(', ')}</p>
              {:else}
                <p class="text-amber-700/70 dark:text-amber-200/50">Nobody tagged in it</p>
              {/if}
            </div>

            <!-- No link through to the existing photo. The warning says enough to recognise
                 it, and opening someone else's photo dialog from here is not what an
                 uploader needs. -->
            <p class="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                data-testid="upload-anyway"
                disabled={entry.sending}
                onclick={() => uploadAnyway(entry)}
                class="rounded-md bg-amber-700 px-2.5 py-1.5 font-semibold text-white hover:bg-amber-800 disabled:opacity-50 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
              >
                {entry.sending ? 'Uploading...' : 'Upload anyway'}
              </button>
              <button
                type="button"
                data-testid="dismiss-duplicate"
                disabled={entry.sending}
                onclick={() => (duplicates = duplicates.filter((d) => d.name !== entry.name))}
                class="text-amber-700 underline disabled:opacity-50 dark:text-amber-300/80"
              >
                Discard
              </button>
            </p>
          </div>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  /*
   * Previews are sized by height, not by a square box.
   *
   * `object-cover` in a square would crop both photos -- and a crop is exactly where a
   * difference between two near-identical pictures tends to hide. Fixing the height instead
   * lets each keep its own shape at the same scale.
   */
  .preview {
    height: 6rem;
    width: auto;
    max-width: 11rem;
  }

  @media (min-width: 40rem) {
    .preview {
      height: 9rem;
      max-width: 15rem;
    }
  }
</style>
