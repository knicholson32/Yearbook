<script lang="ts">
  import { goto } from '$app/navigation';
  import { months as monthNames } from '$lib/helpers';
  import { basicPlural } from '$lib/helpers';
  import { Check, ChevronLeft, ChevronRight, ImagePlus, Inbox, Lock } from 'lucide-svelte';
  import { invalidateAll } from '$app/navigation';
  import Dropzone from '$lib/components/upload/Dropzone.svelte';
  import Avatar from '$lib/components/Avatar.svelte';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  const goToYear = (year: number) => goto(`/upload?year=${year}`, { keepFocus: true, noScroll: true });

  const prevYear = $derived(data.year - 1);
  const nextYear = $derived(data.year + 1);
  const maxYear = $derived(new Date().getFullYear() + 1);
</script>

<svelte:head><title>Upload &middot; {data.year}</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

  <!-- Year switcher -->
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Photos</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {data.total} {basicPlural('photo', data.total)} in {data.year}
        &middot; aim for {data.photosPerMonth} a month
      </p>
    </div>

    <div class="flex items-center gap-1 rounded-lg bg-white p-1 shadow-sm outline outline-gray-200 dark:bg-white/5 dark:outline-white/10">
      <button
        type="button"
        onclick={() => goToYear(prevYear)}
        aria-label="Previous year"
        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronLeft class="size-4" />
      </button>

      <select
        value={data.year}
        data-testid="year-select"
        onchange={(e) => goToYear(Number.parseInt(e.currentTarget.value, 10))}
        aria-label="Year"
        class="rounded-md border-0 bg-transparent py-1 pr-8 pl-2 text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-indigo-600 dark:text-white"
      >
        {#each data.years as year (year)}
          <option value={year} class="dark:bg-gray-800">{year}</option>
        {/each}
      </select>

      <button
        type="button"
        onclick={() => goToYear(nextYear)}
        disabled={nextYear > maxYear}
        aria-label="Next year"
        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-30 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronRight class="size-4" />
      </button>
    </div>
  </div>

  <!-- Drop a whole year's worth here: each photo goes to the month it was taken in, and
       anything that cannot be placed waits in Pending below. -->
  {#if data.lockReason !== null}
    <p
      class="mt-6 flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 outline outline-sky-600/20 dark:bg-sky-400/10 dark:text-sky-200 dark:outline-sky-400/20"
      data-testid="locked-notice"
    >
      <Lock class="size-4 shrink-0" />
      <span>
        {#if data.lockReason === 'published'}
          The {data.year} yearbook is published, so its photos can't be changed.
        {:else}
          {data.year}'s photos are locked while the yearbook is put together.
        {/if}
      </span>
    </p>
  {:else}
    <div class="mt-6">
      <Dropzone year={data.year} onuploaded={() => invalidateAll()} />
    </div>
  {/if}

  <!-- Month grid -->
  <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {#each data.months as month (month.month)}
      {@const done = month.count >= data.photosPerMonth}
      <a
        href="/upload/{data.year}/{month.month}"
        data-testid="month-card"
        data-month={month.month}
        data-done={done}
        class="group relative flex aspect-4/3 flex-col justify-end overflow-hidden rounded-xl bg-gray-100 p-3 outline transition hover:outline-2 hover:outline-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:bg-white/5 {done
          ? 'outline-2 outline-emerald-500 dark:outline-emerald-400'
          : 'outline-gray-200 dark:outline-white/10'}"
        style={month.coverHex === null ? undefined : `background-color: ${month.coverHex}`}
      >
        {#if month.covers.length > 0}
          <!-- Up to four photos tiled to fill the card. The layout changes with the count
               so one photo is never letterboxed and four never look like an afterthought. -->
          <div
            class="absolute inset-0 grid gap-px transition duration-300 group-hover:scale-105"
            class:grid-cols-1={month.covers.length === 1}
            class:grid-cols-2={month.covers.length > 1}
            class:grid-rows-2={month.covers.length > 2}
          >
            {#each month.covers as cover, i (cover.id)}
              <img
                src="/api/image/{cover.id}/512?v={cover.version}"
                srcset="/api/image/{cover.id}/512?v={cover.version} 512w, /api/image/{cover.id}/768?v={cover.version} 768w"
                sizes="(min-width: 1024px) 8rem, 25vw"
                alt=""
                loading="lazy"
                class="size-full object-cover"
                class:row-span-2={month.covers.length === 3 && i === 0}
              />
            {/each}
          </div>
          <div class="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-transparent"></div>
        {/if}

        {#if done}
          <span
            class="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm ring-2 ring-white/80 dark:bg-emerald-400 dark:text-gray-900 dark:ring-gray-900/60"
            title="{data.photosPerMonth} or more photos: this month is done"
            data-testid="month-done"
          >
            <Check class="size-3.5" strokeWidth={3} />
            <span class="sr-only">Done</span>
          </span>
        {/if}

        <div class="relative">
          <div class="text-base font-semibold {month.covers.length === 0 ? 'text-gray-900 dark:text-white' : 'text-white'}">
            {monthNames[month.month - 1]}
          </div>
          <div class="text-xs {month.covers.length === 0 ? 'text-gray-500 dark:text-gray-400' : 'text-white/80'}">
            {#if month.count === 0}
              <span class="inline-flex items-center gap-1"><ImagePlus class="size-3" /> Add photos</span>
            {:else}
              {month.count} {basicPlural('photo', month.count)}
            {/if}
          </div>

          {#if month.people.length > 0}
            <!-- Overlapping row, capped: a busy month should not turn into a wall of faces. -->
            <div class="mt-1.5 flex items-center -space-x-1.5">
              {#each month.people.slice(0, 5) as person (person.id)}
                <Avatar
                  imageId={person.imageId}
                  name={person.name}
                  size={20}
                  class="ring-2 {month.covers.length === 0 ? 'ring-gray-100 dark:ring-gray-900' : 'ring-black/30'}"
                />
              {/each}
              {#if month.people.length > 5}
                <span
                  class="pl-2.5 text-[10px] font-medium {month.covers.length === 0
                    ? 'text-gray-500 dark:text-gray-400'
                    : 'text-white/80'}"
                >
                  +{month.people.length - 5}
                </span>
              {/if}
            </div>
          {/if}
        </div>
      </a>
    {/each}

    {#if data.pending > 0}
      <a
        href="/upload/{data.year}/pending"
        data-testid="pending-card"
        class="group flex aspect-4/3 flex-col justify-end rounded-xl bg-amber-50 p-3 outline outline-amber-200 transition hover:outline-2 hover:outline-amber-500 dark:bg-amber-500/10 dark:outline-amber-500/20"
      >
        <Inbox class="mb-auto size-5 text-amber-600 dark:text-amber-500" />
        <div class="text-base font-semibold text-amber-900 dark:text-amber-200">Pending</div>
        <div class="text-xs text-amber-700 dark:text-amber-300/80">
          {data.pending} {basicPlural('photo', data.pending)} to sort
        </div>
      </a>
    {/if}
  </div>
</div>
