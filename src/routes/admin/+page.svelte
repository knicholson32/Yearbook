<script lang="ts">
  import { goto } from '$app/navigation';
  import { months as monthNames } from '$lib/helpers';
  import { basicPlural } from '$lib/helpers';
  import { ChevronLeft, ChevronRight, Inbox } from 'lucide-svelte';
  import ExportButton from '$lib/components/admin/ExportButton.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { enhance } from '$app/forms';
  import { BookOpen, Eye, EyeOff, BookMarked, Check } from 'lucide-svelte';

  let title = $state('');
  let photobookUrl = $state('');

  /** Feedback for the photo book form: it saves in place, with nothing else to show for it. */
  let photobookSaved = $state(false);
  let photobookError = $state<string | null>(null);
  let photobookTimer: ReturnType<typeof setTimeout> | undefined;
  // Seeded in an effect, not the initialiser, so switching years reloads them.
  $effect.pre(() => {
    title = data.yearTitle;
    photobookUrl = data.photobookUrl;
  });

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  const goToYear = (year: number) =>
    goto(`/admin?year=${year}`, { keepFocus: true, noScroll: true });

  const countFor = (month: number) =>
    data.months.find((entry) => entry.month === month)?.count ?? 0;
</script>

<svelte:head><title>Admin &middot; {data.year}</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
        Yearbook admin
      </h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400" data-testid="year-total">
        {data.total}
        {basicPlural('photo', data.total)} across every group in {data.year}
      </p>
    </div>

    <div
      class="flex items-center gap-1 rounded-lg bg-white p-1 shadow-sm outline outline-gray-200 dark:bg-white/5 dark:outline-white/10"
    >
      <button
        type="button"
        onclick={() => goToYear(data.year - 1)}
        aria-label="Previous year"
        data-testid="admin-prev-year"
        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronLeft class="size-4" />
      </button>
      <span class="px-2 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
        {data.year}
      </span>
      <button
        type="button"
        onclick={() => goToYear(data.year + 1)}
        aria-label="Next year"
        data-testid="admin-next-year"
        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronRight class="size-4" />
      </button>
    </div>
  </div>

  <!-- Publish to the Years tab -->
  <div
    class="mt-6 rounded-xl p-4 shadow-xs outline sm:px-6 {data.published
      ? 'bg-emerald-50 outline-emerald-600/20 dark:bg-emerald-400/10 dark:outline-emerald-400/20'
      : 'bg-white outline-gray-900/10 dark:bg-white/5 dark:outline-white/10'}"
    data-testid="publish-panel"
  >
    <form
      method="POST"
      action="?/setPublished"
      use:enhance={() => async ({ update }) => await update({ reset: false })}
      class="flex flex-wrap items-end justify-between gap-4"
    >
      <input type="hidden" name="year" value={data.year} />

      <div class="grow">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <BookOpen class="size-4" />
          {data.published ? `${data.year} is on the shelf` : `Publish ${data.year}`}
        </h2>
        <p class="mt-0.5 max-w-prose text-sm text-gray-500 dark:text-gray-400">
          {#if data.published}
            Everyone can read this yearbook in the Years tab.
          {:else}
            Puts the finished yearbook in the Years tab, where every group can read it.
          {/if}
        </p>

        <!-- Only while unpublished. The field shares this form with the publish button, so
             the only way to submit a new title from a published year would be to unpublish
             -- which is what you were about to do anyway. An editable box that cannot be
             saved on its own is worse than no box. -->
        {#if !data.published}
          <label class="mt-3 block">
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
              Cover title (optional)
            </span>
            <input
              name="title"
              bind:value={title}
              data-testid="year-title"
              placeholder="{data.year.toFixed(0)}"
              class="mt-1 block w-full max-w-sm rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline outline-gray-300 focus:outline-2 focus:outline-sky-500 dark:bg-white/5 dark:text-white dark:outline-white/10"
            />
          </label>
        {:else if data.yearTitle !== ''}
          <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Cover title:
            <span class="font-medium text-gray-900 dark:text-white">{data.yearTitle}</span>
          </p>
        {/if}
      </div>

      <div class="flex items-center gap-2">
        {#if data.published}
          <a
            href="/years/{data.year}"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
          >
            <Eye class="size-4" />
            View
          </a>
        {/if}
        <button
          type="submit"
          name="published"
          value={data.published ? 'false' : 'true'}
          disabled={data.total === 0}
          data-testid="toggle-published"
          class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40 {data.published
            ? 'text-gray-700 outline outline-gray-300 hover:bg-gray-100 dark:text-gray-200 dark:outline-white/15 dark:hover:bg-white/10'
            : 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'}"
        >
          {#if data.published}
            <EyeOff class="size-4" />
            Unpublish
          {:else}
            <BookOpen class="size-4" />
            Publish
          {/if}
        </button>
      </div>
    </form>
  </div>

  <!-- Photo book link. Separate from the publish panel on purpose: a book is ordered after
       the year is finished, so this has to work while the year is published. -->
  <div
    class="mt-3 rounded-xl bg-white p-4 shadow-xs outline outline-gray-900/10 sm:px-6 dark:bg-white/5 dark:outline-white/10"
    data-testid="photobook-panel"
  >
    <form
      method="POST"
      action="?/setPhotobook"
      use:enhance={() => async ({ result, update }) => {
        clearTimeout(photobookTimer);
        if (result.type === 'failure') {
          photobookError = (result.data as { message?: string })?.message ?? 'Could not save';
          photobookSaved = false;
        } else {
          photobookError = null;
          photobookSaved = true;
          // Long enough to read, short enough that it does not linger as furniture.
          photobookTimer = setTimeout(() => (photobookSaved = false), 2600);
        }
        await update({ reset: false });
      }}
      class="flex flex-wrap items-end gap-4"
    >
      <input type="hidden" name="year" value={data.year} />

      <div class="grow">
        <label
          for="photobook-url"
          class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"
        >
          <BookMarked class="size-4" />
          Photo book link
        </label>
        <p class="mt-0.5 max-w-prose text-sm text-gray-500 dark:text-gray-400">
          A Shutterfly (or similar) link to the printed book of {data.year}. Shown beside the
          cover on the Years shelf. Leave it empty for no link.
        </p>
        <input
          id="photobook-url"
          name="photobookUrl"
          type="url"
          inputmode="url"
          bind:value={photobookUrl}
          data-testid="photobook-url"
          placeholder="https://www.shutterfly.com/..."
          class="mt-2 block w-full max-w-lg rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline outline-gray-300 focus:outline-2 focus:outline-sky-500 dark:bg-white/5 dark:text-white dark:outline-white/10"
        />
      </div>

      <div class="flex items-center gap-3">
        <button
          type="submit"
          data-testid="save-photobook"
          class="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          Save
        </button>

        {#if photobookError !== null}
          <span class="text-sm text-red-600 dark:text-red-400" data-testid="photobook-error">
            {photobookError}
          </span>
        {:else if photobookSaved}
          <span
            class="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"
            data-testid="photobook-saved"
          >
            <Check class="size-4" />
            Saved
          </span>
        {/if}
      </div>
    </form>
  </div>

  <!-- Whole-year export -->
  <div
    class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-4 shadow-xs outline outline-gray-900/10 sm:px-6 dark:bg-white/5 dark:outline-white/10"
  >
    <div>
      <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Export {data.year}</h2>
    </div>
    <ExportButton
      scope={{ kind: 'year', year: data.year }}
      label="Export the year"
      count={data.total}
      variant="default"
      testid="export-year"
    />
  </div>

  {#if data.pending > 0}
    <!-- A warning about photos the admin could not reach would be useless, so it links
         straight to the queue that can file them. -->
    <a
      href="/admin/{data.year}/pending"
      class="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 outline outline-amber-600/20 hover:bg-amber-100 dark:bg-amber-400/10 dark:text-amber-300 dark:outline-amber-400/20 dark:hover:bg-amber-400/15"
      data-testid="admin-pending"
    >
      <Inbox class="size-3.5 shrink-0" />
      <span>
        {data.pending}
        {basicPlural('photo', data.pending)} uploaded to {data.year} but not filed into a month, so
        left out of every export.
      </span>
      <span class="font-semibold underline">File {data.pending === 1 ? 'it' : 'them'}</span>
    </a>
  {/if}

  <!-- Months -->
  <h2 class="mt-8 mb-2 text-base font-semibold text-gray-900 dark:text-white">Months</h2>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {#each monthNames as name, index (name)}
      {@const count = countFor(index + 1)}
      <a
        href="/admin/{data.year}/{index + 1}"
        data-testid="admin-month"
        data-month={index + 1}
        class="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-xs outline outline-gray-900/10 hover:outline-sky-500 dark:bg-white/5 dark:outline-white/10 dark:hover:outline-sky-400"
      >
        <span class="text-sm font-medium text-gray-900 dark:text-white">{name}</span>
        <span class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{count}</span>
      </a>
    {/each}
  </div>

  <!-- Per-group totals -->
  <h2 class="mt-8 mb-2 text-base font-semibold text-gray-900 dark:text-white">Groups</h2>
  {#if data.groups.length === 0}
    <p class="text-sm text-gray-400">No photos in {data.year}.</p>
  {:else}
    <ul
      class="divide-y divide-gray-900/10 overflow-hidden rounded-xl bg-white shadow-xs outline outline-gray-900/10 dark:divide-white/10 dark:bg-white/5 dark:outline-white/10"
    >
      {#each data.groups as group (group.id)}
        <li class="flex items-center justify-between gap-4 px-4 py-3 sm:px-6" data-testid="admin-group">
          <span class="text-sm font-medium text-gray-900 dark:text-white">{group.label}</span>
          <span class="text-sm tabular-nums text-gray-500 dark:text-gray-400">
            {group.count}
            {basicPlural('photo', group.count)}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Who is in the year -->
  <h2 class="mt-8 mb-2 text-base font-semibold text-gray-900 dark:text-white">People</h2>
  <p class="mb-2 text-sm text-gray-500 dark:text-gray-400">
    Photos each person appears in.
  </p>
  {#if data.people.length === 0}
    <p class="text-sm text-gray-400">Nobody is tagged in {data.year} yet.</p>
  {:else}
    <ul class="flex flex-wrap gap-2" data-testid="admin-people">
      {#each data.people as person (person.id)}
        <li
          class="flex items-center gap-2 rounded-full bg-white py-1 pr-2 pl-1 text-sm shadow-xs outline outline-gray-900/10 dark:bg-white/5 dark:outline-white/10"
          data-person={person.id}
        >
          <Avatar
            imageId={person.imageId}
            name={person.name}
            version={person.version}
            size={24}
          />
          <span class="text-gray-900 dark:text-white">{person.name}</span>
          <span
            class="rounded-full bg-gray-100 px-2 text-xs tabular-nums text-gray-600 dark:bg-white/10 dark:text-gray-300"
          >
            {person.count}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
