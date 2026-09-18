<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { monthsFull, basicPlural, joinWithLimit } from '$lib/helpers';
  import Dropzone from '$lib/components/upload/Dropzone.svelte';
  import PhotoDialog from '$lib/components/upload/PhotoDialog.svelte';
  import { ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, MessageSquareText, Users, Lock, CircleCheck } from 'lucide-svelte';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  let captionSaving = $state(false);
  let captionSaved = $state(false);

  // Seeded in an effect, not the initialiser, so navigating between months reloads it.
  let caption = $state('');
  $effect.pre(() => {
    caption = data.caption;
    captionSaved = false;
  });

  let openId = $state<string | null>(null);

  // `?photo=<id>` opens a photo directly. That is what lets a move carry you to the photo
  // in its new month rather than just to the month, and it makes a photo linkable.
  //
  // `seen` is a plain variable on purpose. Comparing against `openId` here would make the
  // effect depend on it, so closing the dialog would re-run this while the URL still held
  // the parameter -- and immediately reopen the photo that was just dismissed.
  let seen: string | null = null;
  $effect(() => {
    const requested = page.url.searchParams.get('photo');
    if (requested === seen) return;
    seen = requested;
    openId = requested;
  });

  /** Keep the URL in step with the dialog, without a navigation. */
  const syncUrl = (id: string | null) => {
    const url = new URL(page.url);
    if (id === null) url.searchParams.delete('photo');
    else url.searchParams.set('photo', id);
    if (url.href !== page.url.href) replaceState(url, page.state);
  };

  const openPhoto = (id: string) => {
    openId = id;
    syncUrl(id);
  };

  const closePhoto = () => {
    openId = null;
    syncUrl(null);
  };

  const open = $derived(data.images.find((i) => i.id === openId) ?? null);
  const title = $derived(`${monthsFull[data.month - 1]} ${data.year}`);

  // `sizes` has to track the column count, not merely be close to it: the browser lays a
  // srcset image out at whatever this claims, so a stale value picks the wrong candidate and
  // the tiles render soft. Gap is 0.75rem; the container is max-w-5xl, which settles at a
  // fixed 60rem of content once its lg padding is taken off.
  const tile = (cols: number, gutters: number, basis: string) =>
    `calc((${basis} - ${(0.75 * (cols - 1)).toFixed(2)}rem - ${gutters}rem) / ${cols})`;
  const tileSizes = $derived(
    [
      `(min-width: 64rem) ${tile(data.columns, 0, '60rem')}`,
      `(min-width: 40rem) ${tile(Math.min(3, data.columns), 3, '100vw')}`,
      tile(Math.min(2, data.columns), 2, '100vw')
    ].join(', ')
  );

  // Wrap around the year boundary so you can walk the whole calendar from here.
  const step = (delta: number) => {
    const index = data.month - 1 + delta;
    const year = data.year + Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12 + 1;
    return `/upload/${year}/${month}`;
  };
</script>

<svelte:head><title>{title} &middot; Upload</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

  <a
    href="/upload?year={data.year}"
    class="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
  >
    <ArrowLeft class="size-4" /> {data.year}
  </a>

  <div class="mt-2 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {data.images.length} {basicPlural('photo', data.images.length)}
      </p>
    </div>

    <div class="flex items-center gap-1">
      <a href={step(-1)} aria-label="Previous month" class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10">
        <ChevronLeft class="size-4" />
      </a>
      <a href={step(1)} aria-label="Next month" class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10">
        <ChevronRight class="size-4" />
      </a>
    </div>
  </div>

  {#if data.canCaption}
    <!-- The group's own note about the month. Autosaves on blur so it behaves like a
         notebook rather than something you have to remember to submit. -->
    <form
      method="POST"
      action="?/saveCaption"
      data-testid="month-caption-form"
      use:enhance={() => {
        captionSaving = true;
        return async ({ result, update }) => {
          captionSaving = false;
          captionSaved = result.type === 'success';
          await update({ reset: false });
        };
      }}
      class="mt-6"
    >
      <div class="flex items-baseline justify-between gap-3">
        <label for="month-caption" class="text-sm font-medium text-gray-900 dark:text-white">
          {title} Caption / Summary
        </label>
        <span class="text-xs text-gray-400">
          {#if captionSaving}
            Saving…
          {:else if captionSaved}
            Saved
          {:else if data.captionUpdatedBy}
            Last edited by {data.captionUpdatedBy}
          {/if}
        </span>
      </div>

      <textarea
        id="month-caption"
        name="caption"
        data-testid="month-caption"
        rows="2"
        maxlength="2000"
        bind:value={caption}
        onblur={(e) => { if (caption !== data.caption) e.currentTarget.form?.requestSubmit(); }}
        placeholder="What happened in {title}?"
        class="mt-1.5 block w-full rounded-lg bg-white px-3 py-2 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500"
      ></textarea>

      <!-- Submitting with the keyboard should work even though blur normally saves. -->
      <button type="submit" class="sr-only" data-testid="month-caption-save">Save note</button>
    </form>
  {/if}

  {#if data.locked}
    <!-- The controls are already hidden (every one keys off `canManage`), so this only has
         to explain why. -->
    <p
      class="mt-6 flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 outline outline-sky-600/20 dark:bg-sky-400/10 dark:text-sky-200 dark:outline-sky-400/20"
      data-testid="locked-notice"
    >
      <Lock class="size-4 shrink-0" />
      <span>
        {#if data.lockReason === 'published'}
          The {data.year} yearbook is published, so this month can't be changed. An admin can
          unpublish it to reopen editing.
        {:else}
          {data.year}'s photos are locked while the yearbook is put together, so this month
          can't be changed. An admin can unlock it to reopen editing.
        {/if}
      </span>
    </p>
  {:else}
    <div class="mt-6">
      <Dropzone year={data.year} month={data.month} onuploaded={() => invalidateAll()} />
    </div>
  {/if}

  {#if data.images.length === data.photosPerMonth}
    <!-- The same target that turns this month's card green on the overview: exactly that
         many, not at least. Counts only this group's photos, like everything else on the page. -->
    <p
      class="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 outline outline-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-200 dark:outline-emerald-400/20"
      data-testid="month-done-notice"
    >
      <CircleCheck class="size-4 shrink-0" />
      <span>
        {title} is done: your group has exactly the {data.photosPerMonth}
        {basicPlural('photo', data.photosPerMonth)} it needs.
      </span>
    </p>
  {/if}

  {#if data.images.length === 0}
    <p class="mt-10 text-center text-sm text-gray-400">No photos in {title} yet.</p>
  {:else}
    <!-- The count is a setting, so the track list cannot be a Tailwind class: nothing scans the
         database, and `grid-cols-{n}` would not be generated. Custom properties instead, with
         narrow screens clamped below the configured count so tiles stay legible on a phone. -->
    <div
      class="photo-grid mt-6 gap-3"
      style="--cols: {data.columns}; --cols-sm: {Math.min(2, data.columns)}; --cols-md: {Math.min(
        3,
        data.columns
      )}"
    >
      {#each data.images as image, index (image.id)}
        <div class="group relative">
          <button
            type="button"
            data-testid="photo-tile"
            data-photo={image.id}
            onclick={() => openPhoto(image.id)}
            class="block w-full overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            <img
              src="/api/image/{image.id}/512"
              srcset="/api/image/{image.id}/512 512w, /api/image/{image.id}/768 768w, /api/image/{image.id}/1024 1024w, /api/image/{image.id}/2048 2048w"
              sizes={tileSizes}
              alt={image.caption ?? 'Uploaded photo'}
              loading="lazy"
              class="aspect-square w-full object-cover transition duration-300 group-hover:brightness-90"
              style="background-color: {image.hex}"
            />
          </button>

          {#if image.misfiled}
            <!-- The fix lives in the photo dialog, so this only has to draw attention. -->
            <span
              data-testid="misfiled-badge"
              title="Taken {monthsFull[image.capturedMonth - 1]} {image.capturedYear}, not {title}"
              class="pointer-events-none absolute right-1 bottom-1 rounded bg-amber-500/90 p-1 text-white shadow-sm backdrop-blur-sm"
            >
              <CalendarClock class="size-3.5" />
              <span class="sr-only">
                Taken {monthsFull[image.capturedMonth - 1]} {image.capturedYear}
              </span>
            </span>
          {/if}

          <!-- Reorder controls, shown on hover and always reachable by keyboard. -->
          <div class="pointer-events-none absolute inset-x-1 top-1 flex justify-between opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <form method="POST" action="?/move" use:enhance class="pointer-events-auto">
              <input type="hidden" name="id" value={image.id} />
              <input type="hidden" name="direction" value="up" />
              <button
                type="submit"
                disabled={index === 0}
                aria-label="Move earlier"
                class="rounded bg-black/50 p-1 text-white backdrop-blur-sm hover:bg-black/70 disabled:invisible"
              >
                <ChevronLeft class="size-3.5" />
              </button>
            </form>
            <form method="POST" action="?/move" use:enhance class="pointer-events-auto">
              <input type="hidden" name="id" value={image.id} />
              <input type="hidden" name="direction" value="down" />
              <button
                type="submit"
                disabled={index === data.images.length - 1}
                aria-label="Move later"
                class="rounded bg-black/50 p-1 text-white backdrop-blur-sm hover:bg-black/70 disabled:invisible"
              >
                <ChevronRight class="size-3.5" />
              </button>
            </form>
          </div>

          <!-- What we know about the photo, so gaps are obvious at a glance. -->
          <div class="mt-1.5 space-y-0.5 px-0.5">
            {#if image.includes.length > 0}
              <p class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                <Users class="size-3 shrink-0" />
                <span class="truncate">{joinWithLimit(image.includes.map((p) => p.name.split(' ')[0]), 3)}</span>
              </p>
            {:else}
              <p class="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                <Users class="size-3 shrink-0" /> Nobody tagged
              </p>
            {/if}
            {#if image.caption !== null}
              <p class="flex items-center gap-1 text-xs text-gray-400">
                <MessageSquareText class="size-3 shrink-0" />
                <span class="truncate">{image.caption}</span>
              </p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<PhotoDialog
  image={open}
  year={data.year}
  month={data.month}
  people={data.people}
  families={data.families}
  canManage={open?.canManage ?? false}
  locked={data.locked}
  onclose={closePhoto}
/>

<style>
  .photo-grid {
    display: grid;
    grid-template-columns: repeat(var(--cols-sm), minmax(0, 1fr));
  }

  /* Tailwind's `sm` and `lg`, so this steps in time with the rest of the page. */
  @media (min-width: 40rem) {
    .photo-grid {
      grid-template-columns: repeat(var(--cols-md), minmax(0, 1fr));
    }
  }

  @media (min-width: 64rem) {
    .photo-grid {
      grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    }
  }
</style>
