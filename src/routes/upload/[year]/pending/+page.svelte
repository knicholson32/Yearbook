<script lang="ts">
  import { enhance } from '$app/forms';
  import { monthsFull, basicPlural, dateToDateStringFormMonthDayYear } from '$lib/helpers';
  import { ArrowLeft, CalendarClock, Trash2, Wand2 } from 'lucide-svelte';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  // One picker per photo, seeded from its capture month so the common case is one click.
  let choice = $state<Record<string, { year: number; month: number }>>({});

  const pick = (id: string, capturedYear: number, capturedMonth: number) =>
    choice[id] ?? { year: capturedYear, month: capturedMonth };

  // Photos whose capture date already names a real month can be filed in bulk.
  const datedCount = $derived(data.images.filter((i) => i.canManage).length);
</script>

<svelte:head><title>Pending &middot; {data.year}</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
  <a
    href="/upload?year={data.year}"
    class="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
  >
    <ArrowLeft class="size-4" /> {data.year}
  </a>

  <div class="mt-2 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Pending</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {data.images.length}
        {basicPlural('photo', data.images.length)} we couldn't place in {data.year} automatically
      </p>
    </div>

    {#if datedCount > 0}
      <form method="POST" action="?/assignAllByDate" use:enhance>
        <button
          type="submit"
          data-testid="assign-all"
          class="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          <Wand2 class="size-4" /> File all by capture date
        </button>
      </form>
    {/if}
  </div>

  {#if data.images.length === 0}
    <p class="mt-10 text-center text-sm text-gray-400">
      Nothing waiting. Photos land here when their capture date falls outside {data.year}.
    </p>
  {:else}
    <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.images as image (image.id)}
        {@const chosen = pick(image.id, image.capturedYear, image.capturedMonth)}
        <div data-testid="pending-photo" data-photo={image.id} class="overflow-hidden rounded-xl outline outline-gray-200 dark:outline-white/10">
          <img
            src="/api/image/{image.id}/512"
            srcset="/api/image/{image.id}/512 512w, /api/image/{image.id}/768 768w"
            sizes="(min-width: 1024px) 20rem, (min-width: 640px) 45vw, 90vw"
            alt={image.caption ?? 'Pending photo'}
            loading="lazy"
            class="aspect-4/3 w-full object-cover"
            style="background-color: {image.hex}"
          />

          <div class="space-y-2 p-3">
            <p class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <CalendarClock class="size-3.5 shrink-0" />
              Taken {dateToDateStringFormMonthDayYear(image.date)}
            </p>

            {#if image.canManage}
              <form method="POST" action="?/assign" use:enhance class="flex gap-1.5">
                <input type="hidden" name="id" value={image.id} />
                <select
                  name="month"
                  data-testid="assign-month"
                  value={chosen.month}
                  onchange={(e) => (choice[image.id] = { ...chosen, month: Number(e.currentTarget.value) })}
                  aria-label="Month"
                  class="grow rounded-md bg-white px-2 py-1 text-xs text-gray-900 outline-1 -outline-offset-1 outline-gray-300 dark:bg-white/5 dark:text-white dark:outline-white/10"
                >
                  {#each monthsFull as name, i (name)}
                    <option value={i + 1} class="dark:bg-gray-800">{name}</option>
                  {/each}
                </select>
                <input
                  name="year"
                  type="number"
                  data-testid="assign-year"
                  value={chosen.year}
                  onchange={(e) => (choice[image.id] = { ...chosen, year: Number(e.currentTarget.value) })}
                  aria-label="Year"
                  class="w-20 rounded-md bg-white px-2 py-1 text-xs text-gray-900 outline-1 -outline-offset-1 outline-gray-300 dark:bg-white/5 dark:text-white dark:outline-white/10"
                />
                <button
                  type="submit"
                  data-testid="assign-submit"
                  class="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  File
                </button>
              </form>

              <form method="POST" action="?/delete" use:enhance>
                <input type="hidden" name="id" value={image.id} />
                <button
                  type="submit"
                  class="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  <Trash2 class="size-3" /> Delete
                </button>
              </form>
            {:else}
              <p class="text-xs text-gray-400">Uploaded by another group</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
