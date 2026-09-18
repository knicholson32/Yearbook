<script lang="ts">
  import { basicPlural } from '$lib/helpers';
  import { BookOpen, Library, BookMarked } from 'lucide-svelte';
  import { averageHex } from '$lib/yearbook/colour';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  // Only the hue comes from the photos; CSS sets the depth and saturation.
  const coverTint = (palette: string[]) => averageHex(palette);

  /**
   * Colours for the background wash, one per published year.
   *
   * Taken from the books themselves, so the page is tinted by what is actually on the shelf
   * -- a green summer pushes its own corner green. Four is the useful maximum: past that the
   * washes overlap into a single muddy field, so later years cycle back over the same slots.
   *
   * The fallback is not decorative filler; it is what an empty shelf shows, and it has to
   * look deliberate rather than broken.
   */
  const AURORA_FALLBACK = ['#3b82f6', '#f59e0b', '#ec4899', '#10b981'];

  const aurora = $derived(
    data.years.length === 0
      ? AURORA_FALLBACK
      : Array.from({ length: 4 }, (_, i) =>
          averageHex(data.years[i % data.years.length].palette)
        )
  );
</script>

<svelte:head><title>Yearbook</title></svelte:head>

<!-- Sits behind everything, outside the content flow, and never takes a click. Which
     treatment shows is the `years.background` setting, so switching back is one form
     submission rather than an edit. -->
{#if data.background === 'aurora'}
  <div class="aurora" aria-hidden="true" data-testid="aurora">
    {#each aurora as colour, i (i)}
      <span style="--c: {colour}"></span>
    {/each}
  </div>
{/if}

<div class="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
  <header class="mb-10">
    <p class="eyebrow text-xs font-semibold tracking-[0.2em] text-gray-400 uppercase">
      The collection
    </p>
    <h1 class="book-title mt-2 text-5xl leading-none font-black tracking-tight text-gray-900 sm:text-6xl dark:text-white">
      Yearbooks
    </h1>
    <p class="mt-3 max-w-prose text-sm text-gray-500 dark:text-gray-400">
      Finished <span class="text-black font-bold">{data.familyName}</span> Yearbooks
    </p>
  </header>

  {#if data.years.length === 0}
    <div
      class="rounded-2xl border border-dashed border-gray-300 px-6 py-16 text-center dark:border-white/15"
      data-testid="shelf-empty"
    >
      <Library class="mx-auto size-8 text-gray-300 dark:text-white/20" />
      <p class="mt-4 text-base font-semibold text-gray-900 dark:text-white">
        Nothing on the shelf yet
      </p>
      {#if data.admin}
        <a
          href="/admin"
          class="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          <BookOpen class="size-4" />
          Go to the admin dashboard
        </a>
      {/if}
    </div>
  {:else}
    <ul class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 lg:gap-8" data-testid="shelf">
      {#each data.years as book (book.year)}
        <li>
          <a
            href="/years/{book.year}"
            data-testid="yearbook-cover"
            data-year={book.year}
            class="book group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500"
          >
            <!-- 2:3 is a book, not a card. The spine and the lift on hover are what sell it
                 as an object you pick up rather than a tile you click. -->
            <div
              class="book-cover relative aspect-2/3 overflow-hidden rounded-r-lg rounded-l-sm shadow-lg transition duration-300 group-hover:-translate-y-1.5 group-hover:shadow-2xl"
              style="--tint: {coverTint(book.palette)}"
            >
              <!-- Photos from the year, ghosted back so the typography stays the subject. -->
              <!-- Fixed 2x2 tracks, for the same reason as the yearbook page's cover: a
                   photo's own height must never decide where the others sit. -->
              <div class="absolute inset-0 grid grid-cols-2 grid-rows-2 opacity-45">
                {#each book.cover as photo (photo.id)}
                  <!-- Embedded in the page (see `publishedYears`), so it paints with the
                       cover instead of popping in afterwards. No `srcset` and no lazy
                       loading on purpose: either would send the browser back to the network
                       for a larger copy and bring the pop-in back. 256px is ample for a
                       ghosted quarter of a cover at 45% opacity. -->
                  <div
                    class="relative min-h-0 min-w-0 overflow-hidden"
                    style="background-color: {photo.hex}"
                  >
                    <img
                      src={photo.src}
                      alt=""
                      aria-hidden="true"
                      decoding="sync"
                      class="absolute inset-0 size-full object-cover"
                    />
                  </div>
                {/each}
              </div>

              <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/55"></div>
              <div class="spine absolute inset-y-0 left-0 w-3"></div>

              <div class="relative flex h-full flex-col justify-between p-4 sm:p-5">
                <p class="text-[10px] font-semibold tracking-[0.18em] text-white/70 uppercase">
                  Yearbook
                </p>

                <div>
                  <p class="book-title text-4xl leading-none font-black text-white sm:text-5xl">
                    {book.year}
                  </p>
                  {#if book.title !== null && book.title !== ''}
                    <p class="mt-1.5 text-sm font-medium text-white/85">{book.title}</p>
                  {/if}
                  <p class="mt-2 text-[11px] tracking-wide text-white/60">
                    {book.count}
                    {basicPlural('photo', book.count)}
                  </p>
                </div>
              </div>
            </div>
          </a>

          {#if book.photobookUrl !== null && book.photobookUrl !== ''}
            <a
              href={book.photobookUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="photobook-link"
              class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 dark:text-gray-300 dark:decoration-white/25 dark:hover:text-white"
            >
              <BookMarked class="size-3.5 shrink-0" />
              Printed photo book
            </a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .aurora {
    position: fixed;
    inset: 0;
    z-index: -10;
    overflow: hidden;
    pointer-events: none;
  }

  /*
   * Each wash is an enormous, heavily blurred disc of one year's colour.
   *
   * `vmax` rather than `vw`: on a tall phone a `vw`-sized disc is a small dot near the top,
   * which reads as a stray blob rather than a wash.
   */
  .aurora span {
    position: absolute;
    width: 70vmax;
    height: 70vmax;
    border-radius: 50%;
    filter: blur(90px);
    /* Fallback for browsers without relative colour syntax. */
    background: radial-gradient(circle at center, var(--c), transparent 68%);
    /*
     * The year's hue, forced bright and saturated.
     *
     * `clamp` with a real floor, not `min`: an average of many photos lands close to neutral,
     * where chroma is near zero -- multiplying that still leaves grey, which is why the wash
     * has to be given a minimum saturation rather than just a ceiling.
     *
     * `--dh` rotates each wash off that hue, so a shelf with a single book still gets a
     * multi-coloured background instead of four identical discs.
     */
    background: radial-gradient(
      circle at center,
      oklch(from var(--c) 0.8 clamp(0.11, calc(c * 5), 0.19) calc(h + var(--dh, 0))),
      transparent 68%
    );
    opacity: 0.55;
    animation: drift 36s ease-in-out infinite alternate;
  }

  /* Spread to the corners and started at different points in the cycle, so they cross and
     part rather than sliding as one. */
  .aurora span:nth-child(1) {
    --dh: 0;
    top: -22vmax;
    left: -18vmax;
  }
  .aurora span:nth-child(2) {
    --dh: 75;
    top: -26vmax;
    right: -20vmax;
    animation-delay: -9s;
    animation-duration: 44s;
  }
  .aurora span:nth-child(3) {
    --dh: 165;
    bottom: -30vmax;
    left: 8vmax;
    animation-delay: -18s;
    animation-duration: 52s;
  }
  .aurora span:nth-child(4) {
    --dh: 255;
    bottom: -26vmax;
    right: -14vmax;
    animation-delay: -27s;
    animation-duration: 40s;
  }

  @keyframes drift {
    from {
      transform: translate3d(0, 0, 0) scale(1);
    }
    to {
      transform: translate3d(6vmax, 4vmax, 0) scale(1.12);
    }
  }

  /* Darker and more restrained at night, where a bright wash behind white text is glare. */
  :global(.dark) .aurora span {
    opacity: 0.38;
    background: radial-gradient(circle at center, var(--c), transparent 68%);
    background: radial-gradient(
      circle at center,
      oklch(from var(--c) 0.55 clamp(0.12, calc(c * 5), 0.2) calc(h + var(--dh, 0))),
      transparent 68%
    );
  }

  @media (prefers-reduced-motion: reduce) {
    .aurora span {
      animation: none;
    }
  }

  /* A heavier, tighter face for the numerals than the body stack, so a cover reads as a
     title page. Falls back through common system serifs before any generic. */
  .book-title {
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman',
      serif;
    font-feature-settings: 'lnum' 1;
  }

  /* The bound edge. Darkening rather than a fixed colour keeps it in step with whatever
     colour the year's photos produced. */
  /* The bound cloth. The fallback is the year's own average; browsers with relative colour
     syntax get the same hue pushed deep and saturated, which is what stops every cover from
     converging on the same grey. */
  .book-cover {
    background-color: var(--tint);
    background-color: oklch(from var(--tint) 0.34 min(calc(c * 4), 0.17) h);
  }

  .spine {
    background: linear-gradient(
      to right,
      rgb(0 0 0 / 0.45),
      rgb(0 0 0 / 0.15) 60%,
      rgb(255 255 255 / 0.12)
    );
  }
</style>
