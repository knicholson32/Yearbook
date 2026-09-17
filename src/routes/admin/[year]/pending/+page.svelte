<script lang="ts">
  import { enhance } from '$app/forms';
  import { monthsFull, basicPlural, dateToDateStringFormMonthDayYear } from '$lib/helpers';
  import Avatar from '$lib/components/Avatar.svelte';
  import { ArrowLeft, CalendarClock, Trash2, Wand2 } from 'lucide-svelte';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  // One picker per photo, seeded from its capture month so the common case is one click.
  let choice = $state<Record<string, { year: number; month: number }>>({});

  const pick = (id: string, capturedYear: number, capturedMonth: number) =>
    choice[id] ?? { year: capturedYear, month: capturedMonth };

  /**
   * Every pending photo carries a date, so the bulk action can always run.
   *
   * It cannot promise that date came from the camera: whether a photo was dated from EXIF is
   * returned at upload but never stored, so after the fact an undated photo -- which fell
   * back to the file's modification time -- is indistinguishable from a dated one. Each row
   * therefore shows the date that would be used, rather than the button claiming certainty.
   */
  const datedCount = $derived(data.images.length);
</script>

<svelte:head><title>Admin &middot; Pending {data.year}</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
  <a
    href="/admin?year={data.year}"
    class="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
  >
    <ArrowLeft class="size-4" /> All of {data.year}
  </a>

  <div class="mt-2 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Unfiled</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400" data-testid="pending-total">
        {data.images.length}
        {basicPlural('photo', data.images.length)} uploaded to {data.year} without a month,
        across every group. These are left out of every export until they are filed.
      </p>
    </div>

    {#if datedCount > 0}
      <form method="POST" action="?/assignAllByDate" use:enhance>
        <button
          type="submit"
          data-testid="file-all-by-date"
          class="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          <Wand2 class="size-4" />
          File all {datedCount} by their date
        </button>
      </form>
    {/if}
  </div>

  {#if data.images.length === 0}
    <p class="mt-16 text-center text-sm text-gray-400" data-testid="pending-empty">
      Nothing is waiting to be filed in {data.year}.
    </p>
  {:else}
    <ul class="mt-6 space-y-3" data-testid="pending-list">
      {#each data.images as image (image.id)}
        <!-- Named apart from the `choice` record above: shadowing it would make the
             picker below write to this const instead of to component state. -->
        {@const selected = pick(image.id, image.capturedYear, image.capturedMonth)}
        <li
          class="flex flex-wrap items-center gap-4 rounded-xl bg-white p-3 shadow-xs outline outline-gray-900/10 sm:px-4 dark:bg-white/5 dark:outline-white/10"
          data-testid="pending-row"
          data-photo={image.id}
        >
          <img
            src="/api/image/{image.id}/512"
            srcset="/api/image/{image.id}/256 256w, /api/image/{image.id}/512 512w"
            sizes="7rem"
            alt={image.caption ?? 'Unfiled photo'}
            loading="lazy"
            class="h-20 w-28 shrink-0 rounded-md object-cover"
            style="background-color: {image.hex}"
          />

          <div class="min-w-44 grow">
            <!-- Whose photo it is matters more here than on a group's own queue: an admin
                 is filing for families other than their own. -->
            <div class="flex items-center gap-2">
              <Avatar
                imageId={image.uploader.imageId}
                gravatarHash={image.uploader.gravatarHash}
                name={image.uploader.name}
                version={image.uploader.version}
                size={20}
              />
              <span class="text-sm font-medium text-gray-900 dark:text-white">
                {image.uploader.name}
              </span>
              <span class="text-xs text-gray-400">{image.group}</span>
            </div>

            <p class="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <CalendarClock class="size-3.5" />
              Dated {dateToDateStringFormMonthDayYear(image.date)}
              <span class="text-gray-400">
                &rarr; {monthsFull[image.capturedMonth - 1]}
                {image.capturedYear}
              </span>
            </p>

            {#if image.caption !== null && image.caption.trim() !== ''}
              <p class="mt-1 truncate text-xs text-gray-500 italic dark:text-gray-400">
                {image.caption}
              </p>
            {/if}
          </div>

          <form method="POST" action="?/assign" use:enhance class="flex gap-1.5">
            <input type="hidden" name="id" value={image.id} />
            <input type="hidden" name="year" value={selected.year} />
            <select
              name="month"
              data-testid="pending-month"
              value={selected.month}
              onchange={(e) =>
                (choice[image.id] = { year: selected.year, month: Number(e.currentTarget.value) })}
              class="rounded-md bg-white px-2 py-1.5 text-sm text-gray-900 outline outline-gray-300 dark:bg-white/5 dark:text-white dark:outline-white/10"
            >
              {#each monthsFull as name, i (name)}
                <option value={i + 1} class="dark:bg-gray-800">{name}</option>
              {/each}
            </select>
            <button
              type="submit"
              data-testid="pending-file"
              class="rounded-md bg-sky-600 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-sky-500"
            >
              File
            </button>
          </form>

          <form method="POST" action="?/delete" use:enhance>
            <input type="hidden" name="id" value={image.id} />
            <button
              type="submit"
              data-testid="pending-delete"
              aria-label="Delete this photo"
              class="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            >
              <Trash2 class="size-4" />
            </button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
</div>
