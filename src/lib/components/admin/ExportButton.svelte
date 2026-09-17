<script lang="ts">
  /**
   * Start an export and follow it to completion.
   *
   * The work happens in a background job on the server, so this posts once to start it and
   * then polls for progress. A year of photos is minutes of decoding, and a button that
   * just spins for that long looks broken -- the count and the current filename are there
   * so it is obvious something is still happening.
   */
  import { Download, Loader2, TriangleAlert } from 'lucide-svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import { Button } from '$lib/components/ui/button/index.js';

  interface Scope {
    kind: 'year' | 'month' | 'group';
    year: number;
    month?: number;
    familyId?: string;
  }

  interface Job {
    id: string;
    status: 'pending' | 'running' | 'done' | 'error';
    label: string;
    total: number;
    done: number;
    passthrough: number;
    failed: { id: string; message: string }[];
    current: string | null;
    bytes: number;
    fileName: string;
    error: string | null;
    elapsedMs: number;
  }

  interface Props {
    scope: Scope;
    /** Button text. */
    label: string;
    /** How many photos this covers, so a no-op export can be disabled up front. */
    count: number;
    variant?: 'default' | 'outline' | 'secondary' | 'ghost';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    testid?: string;
  }

  let { scope, label, count, variant = 'outline', size = 'sm', testid }: Props = $props();

  let job = $state<Job | null>(null);
  let starting = $state(false);
  let failure = $state<string | null>(null);

  const running = $derived(starting || job?.status === 'pending' || job?.status === 'running');
  const percent = $derived(
    job === null || job.total === 0 ? null : Math.round((job.done / job.total) * 100)
  );

  const humanBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
  };

  /**
   * Poll until the job leaves a running state.
   *
   * Fixed interval rather than backoff: these finish in seconds to minutes, and a stale
   * count is the one thing this component exists to avoid.
   */
  const followJob = async (id: string) => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await fetch(`/api/admin/export/${id}`);
      if (!response.ok) {
        failure = `Lost track of the export (${response.status})`;
        job = null;
        return;
      }

      job = (await response.json()) as Job;
      if (job.status === 'done' || job.status === 'error') return;
    }
  };

  const start = async () => {
    failure = null;
    job = null;
    starting = true;

    try {
      const response = await fetch('/api/admin/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope)
      });

      if (!response.ok) {
        failure = (await response.text()) || `Could not start the export (${response.status})`;
        return;
      }

      job = (await response.json()) as Job;
      starting = false;
      await followJob(job.id);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      starting = false;
    }
  };
</script>

<div class="flex flex-col gap-1.5" data-testid={testid}>
  {#if job?.status === 'done'}
    <!-- A plain link, so the browser handles the save the way the user expects. -->
    <Button
      href="/api/admin/export/{job.id}/download"
      {variant}
      {size}
      data-testid="export-download"
      class="gap-1.5"
    >
      <Download class="size-4" />
      Save {job.fileName} ({humanBytes(job.bytes)})
    </Button>
  {:else}
    <Button
      type="button"
      onclick={start}
      disabled={running || count === 0}
      {variant}
      {size}
      data-testid="export-start"
      class="gap-1.5"
    >
      {#if running}
        <Loader2 class="size-4 animate-spin" />
        Preparing...
      {:else}
        <Download class="size-4" />
        {label}
      {/if}
    </Button>
  {/if}

  {#if running && job !== null}
    <ProgressBar {percent} />
    <p class="text-xs text-gray-500 tabular-nums dark:text-gray-400" data-testid="export-progress">
      {job.done} of {job.total}
      {#if job.current !== null}&middot; <span class="font-mono">{job.current}</span>{/if}
    </p>
  {:else if running}
    <ProgressBar percent={null} />
  {/if}

  {#if job?.status === 'done'}
    <p class="text-xs text-gray-500 dark:text-gray-400" data-testid="export-summary">
      {job.total}
      {job.total === 1 ? 'photo' : 'photos'} in {(job.elapsedMs / 1000).toFixed(1)}s
      &middot; {job.passthrough} copied as-is, {job.total - job.passthrough - job.failed.length} converted
    </p>
  {/if}

  {#if job !== null && job.failed.length > 0}
    <p class="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-500" data-testid="export-failed">
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
      <span>{job.failed.length} could not be converted and were left out.</span>
    </p>
  {/if}

  {#if failure !== null || job?.status === 'error'}
    <p class="text-xs text-red-600 dark:text-red-400" data-testid="export-error">
      {failure ?? job?.error}
    </p>
  {/if}
</div>
