<script lang="ts">
  /**
   * One year, read as a book.
   *
   * The pacing is the feature. A cover you have to pass, a title page for every month, wide
   * margins, and photos at their own shape rather than cropped to a grid -- so scrolling
   * through it feels like turning pages rather than scanning a folder.
   */
  import { monthsFull, basicPlural, dateToDateStringFormMonthDayYear } from '$lib/helpers';
  import PhotoViewer from '$lib/components/yearbook/PhotoViewer.svelte';
  import { ChevronLeft, ChevronRight, Library, Pencil } from 'lucide-svelte';
  import { averageHex } from '$lib/yearbook/colour';
  import { srcsetFor } from '$lib/image';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  /** Roman numerals for the month title pages. Twelve is as far as this ever has to go. */
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  // Only the hue comes from the photos; CSS sets the depth and saturation.
  const coverTint = $derived(averageHex(data.palette));

  /**
   * Every photo in the year, flattened back into reading order.
   *
   * The page renders them grouped into months and blocks, but the viewer pages through the
   * whole year -- so this rebuilds the flat sequence the layout was built from, and each
   * photo carries its index into it.
   */
  const sequence = $derived(
    data.months.flatMap((month) =>
      month.blocks.flatMap((block) =>
        block.kind === 'feature' ? [block.photo] : block.items.map((item) => item.photo)
      )
    )
  );

  const indexOf = (id: string) => sequence.findIndex((photo) => photo.id === id);

  let viewing = $state<number | null>(null);

  const published = $derived(
    // The helper takes seconds; `publishedAt` arrives as epoch milliseconds.
    data.publishedAt === null ? null : dateToDateStringFormMonthDayYear(data.publishedAt / 1000)
  );
</script>

<svelte:head><title>{data.year} &middot; Yearbook</title></svelte:head>

<!-- Follows the reader's theme like the rest of the app: light page in light mode, dark in dark
     mode. The page ground comes from `body`, which mode-watcher's head script has already
     themed before first paint, so neither mode flashes the other's colour. -->
<article class="yearbook pb-24">
  <!-- Cover -->
  <!--
    On a phone the cover is a full-screen title page: exactly the space left under the nav,
    so the book opens on the cover alone with nothing peeking in beneath it. `--nav-height`
    (set by the layout) already includes the safe-area inset.

    It also runs through the home-indicator strip at the bottom (`safe-area-inset-bottom`).
    In the installed app the page extends behind that strip, and without adding it the cover
    stopped just above it and left a bar. Where there is no such strip the inset is zero.

    In the installed app the height comes from `--app-height` (the measured `innerHeight`, set
    in app.html), because iOS reports viewport units short there and the cover stopped above
    the bottom of the screen. In a browser tab that variable is unset and `svh` is used.

    `svh`, not `dvh`: the small viewport is what is visible while Safari's toolbar is showing,
    which is how the page first loads. `dvh` would track the toolbar as it collapses on
    scroll and resize the cover mid-scroll, shoving everything under it. Below `lg` rather
    than `sm`, so a phone turned sideways -- wider than `sm`, still a phone -- gets it too.
    On a desktop the cover keeps its original height and the book starts below it.
  -->
  <header
    class="cover relative flex min-h-[calc(var(--app-height,calc(100svh+env(safe-area-inset-bottom)))-var(--nav-height,4rem))] flex-col justify-end overflow-hidden lg:min-h-[78vh]"
    style="--tint: {coverTint}"
    data-testid="yearbook-cover"
  >
    <!-- Every track is fixed before a single photo arrives: explicit rows and columns, each
         an equal share of the cover. With auto rows the grid sized each row from the photos'
         own heights, so the collage re-flowed every time another image finished loading.
         The photo inside a cell is positioned absolutely, which keeps its intrinsic size from
         feeding back into the track at all. Six photos fill 2x3, 3x2 and 6x1 exactly. -->
    <div
      class="absolute inset-0 grid grid-cols-2 grid-rows-3 opacity-40 sm:grid-cols-3 sm:grid-rows-2 lg:grid-cols-6 lg:grid-rows-1"
      data-testid="cover-collage"
    >
      {#each data.cover as photo (photo.id)}
        <div class="relative min-h-0 min-w-0 overflow-hidden" style="background-color: {photo.hex}">
          <!-- `sizes` follows the column count: half, a third, a sixth of the viewport. -->
          <img
            src="/api/image/{photo.id}/768"
            srcset="/api/image/{photo.id}/512 512w, /api/image/{photo.id}/768 768w, /api/image/{photo.id}/1024 1024w, /api/image/{photo.id}/2048 2048w"
            sizes="(min-width: 64rem) 17vw, (min-width: 40rem) 34vw, 50vw"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 size-full object-cover"
          />
        </div>
      {/each}
    </div>
    <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/60"></div>

    <div class="relative mx-auto w-full max-w-4xl px-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-10">
      <p class="text-[11px] font-semibold tracking-[0.28em] text-white/70 uppercase">Yearbook</p>
      <h1 class="display mt-3 text-[22vw] leading-[0.82] font-black text-white sm:text-[14rem]">
        {data.year}
      </h1>
      {#if data.title !== null && data.title !== ''}
        <p class="display mt-2 text-2xl text-white/90 italic sm:text-3xl">{data.title}</p>
      {/if}
      <p class="mt-5 text-sm tracking-wide text-white/70">
        {data.total}
        {basicPlural('photograph', data.total)} across {data.months.length}
        {basicPlural('month', data.months.length)}
        {#if published !== null}&middot; published {published}{/if}
      </p>
    </div>
  </header>

  {#each data.months as month (month.month)}
    <!-- Month title page. Full-width rule and a lot of air, so the eye resets between
         months instead of running one into the next. -->
    <section class="month" data-testid="yearbook-month" data-month={month.month}>
      <div class="mx-auto max-w-5xl px-6 pt-20 pb-8 sm:px-10">
        <div class="flex items-end justify-between gap-6 border-b-2 border-gray-400 pb-4 dark:border-white">
          <div>
            <p class="display text-sm tracking-[0.3em] text-gray-400 uppercase">
              {ROMAN[month.month - 1]}
            </p>
            <h2 class="display mt-1 text-5xl leading-none font-black tracking-tight text-gray-900 sm:text-7xl dark:text-white">
              {monthsFull[month.month - 1]}
            </h2>
          </div>
          <p class="pb-2 text-right text-xs tracking-wide text-gray-400 tabular-nums">
            {month.count}
            {basicPlural('photo', month.count)}
          </p>
        </div>
      </div>

      <div class="mx-auto max-w-5xl space-y-4 px-6 sm:px-10">
        {#each month.blocks as block, index (index)}
          {#if block.kind === 'feature'}
            <!-- A photo given the page to itself. Its caption sits underneath as a plate
                 caption would, rather than floating over the image. -->
            <figure class="feature pt-4 pb-6" data-testid="yearbook-feature">
              <button
                type="button"
                onclick={() => (viewing = indexOf(block.photo.id))}
                data-testid="book-photo"
                data-photo={block.photo.id}
                aria-label="View photograph larger"
                class="block w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500"
              >
                <img
                  src="/api/image/{block.photo.id}/1024"
                  srcset={srcsetFor(block.photo.id, block.photo.width, 768)}
                  sizes="(min-width: 64rem) 60rem, 100vw"
                  alt={block.photo.caption ?? ''}
                  loading="lazy"
                  class="w-full rounded-sm"
                  style="aspect-ratio: {block.aspect}; object-fit: cover; background-color: {block.photo.hex}"
                />
              </button>
              {#if block.photo.caption !== null && block.photo.caption.trim() !== ''}
                <figcaption class="caption mt-3 max-w-prose text-base leading-relaxed text-gray-700 dark:text-gray-300">
                  {block.photo.caption}
                </figcaption>
              {/if}
            </figure>
          {:else}
            <!-- A justified row: the container carries the row's total aspect, and each
                 photo takes its own share of the width, so nothing is cropped and both
                 edges stay flush. Below `sm` the row wraps instead, since four photos
                 across a phone is unreadable. -->
            <div
              class="row gap-2 sm:flex"
              data-fill={block.fill}
              style="--row-aspect: {block.aspect}"
            >
              {#each block.items as item (item.photo.id)}
                <figure class="row-item" style="--grow: {item.aspect}; --w: {item.widthPercent}%">
                  <button
                    type="button"
                    onclick={() => (viewing = indexOf(item.photo.id))}
                    data-testid="book-photo"
                    data-photo={item.photo.id}
                    aria-label="View photograph larger"
                    class="block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500"
                  >
                    <img
                      src="/api/image/{item.photo.id}/768"
                      srcset={srcsetFor(item.photo.id, item.photo.width)}
                      sizes="(min-width: 64rem) {Math.round((item.widthPercent / 100) * 60)}rem, 100vw"
                      alt={item.photo.caption ?? ''}
                      loading="lazy"
                      class="size-full rounded-sm object-cover"
                      style="background-color: {item.photo.hex}"
                    />
                  </button>
                  {#if item.photo.caption !== null && item.photo.caption.trim() !== ''}
                    <figcaption class="caption mt-2 text-[13px] leading-snug text-gray-600 dark:text-gray-300">
                      {item.photo.caption}
                    </figcaption>
                  {/if}
                </figure>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/each}

  <!-- Back matter -->
  <nav class="mx-auto mt-20 flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 sm:px-10">
    {#if data.previous !== null}
      <a
        href="/years/{data.previous}"
        data-testid="prev-year"
        class="display inline-flex items-center gap-2 text-lg font-bold text-gray-900 hover:text-sky-600 dark:text-white dark:hover:text-sky-400"
      >
        <ChevronLeft class="size-5" />
        {data.previous}
      </a>
    {:else}
      <span></span>
    {/if}

    <a
      href="/"
      class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
    >
      <Library class="size-4" />
      All yearbooks
    </a>

    {#if data.next !== null}
      <a
        href="/years/{data.next}"
        data-testid="next-year"
        class="display inline-flex items-center gap-2 text-lg font-bold text-gray-900 hover:text-sky-600 dark:text-white dark:hover:text-sky-400"
      >
        {data.next}
        <ChevronRight class="size-5" />
      </a>
    {:else}
      <span></span>
    {/if}
  </nav>

  {#if data.admin}
    <!-- Publishing does not freeze a year, so the way back to editing it stays in reach. -->
    <p class="mx-auto mt-10 max-w-5xl px-6 text-xs text-gray-400 sm:px-10">
      <a href="/admin?year={data.year}" class="inline-flex items-center gap-1.5 hover:text-gray-600 dark:hover:text-gray-200">
        <Pencil class="size-3.5" />
        Edit {data.year} in the admin dashboard
      </a>
    </p>
  {/if}
</article>

<PhotoViewer photos={sequence} bind:index={viewing} onclose={() => (viewing = null)} />

<style>
  /* Same binding colour as the shelf cover, so opening a book keeps its identity. */
  /*
   * A deep, almost-neutral ground with only a trace of the year's hue.
   *
   * The chroma is deliberately low. Boosted hard it reads as a colour cast behind the year
   * numeral rather than as a binding, and a warm average turns the whole banner pink -- which
   * competes with the photographs it is sitting behind.
   */
  .cover {
    background-color: var(--tint);
    background-color: oklch(from var(--tint) 0.26 min(calc(c * 1.4), 0.045) h);
  }

  .display {
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman',
      serif;
    font-feature-settings: 'lnum' 1;
  }

  /* Captions are the book's voice, so they get a serif and a little italic rather than the
     interface's sans. */
  .caption {
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman',
      serif;
    font-style: italic;
  }

  /*
   * A justified row.
   *
   * The container's aspect ratio is the sum of its photos' aspect ratios, so its height is
   * exactly what those photos need at this width -- that is what keeps both edges flush
   * while every photo keeps its own shape.
   *
   * `min-height: 0` matters: without it the flex items refuse to shrink below their
   * intrinsic height and the row grows past the ratio it was given.
   */
  @media (min-width: 40rem) {
    .row {
      aspect-ratio: var(--row-aspect);
      min-height: 0;
    }

    .row-item {
      flex: var(--grow) 1 0;
      min-width: 0;
      min-height: 0;
      /* The caption is out of flow so it cannot steal height from the photo and break the
         row's arithmetic; it hangs just below instead. */
      position: relative;
    }

    .row-item img {
      height: 100%;
    }

    /* A short trailing row: photos take only the width they actually need at this row's
       height, so the leftover space falls at the end of the row rather than being taken out
       of the pictures. */
    .row[data-fill='false'] .row-item {
      flex: 0 0 auto;
      width: var(--w);
    }

    .row-item figcaption {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
    }
  }

  /* On a phone a four-across row is unreadable, so rows stop being rows: each photo takes
     the full width at its own aspect ratio and captions return to normal flow. */
  @media (max-width: 39.999rem) {
    .row {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .row-item img {
      height: auto;
    }
  }
</style>
