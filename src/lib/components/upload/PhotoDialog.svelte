<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';
  import * as Dialog from '$lib/components/ui/dialog';
  import PeoplePicker from './PeoplePicker.svelte';
  import { srcsetFor } from '$lib/image';
  import { dateToDateStringFormMonthDayYear, monthsFull } from '$lib/helpers';
  import { CalendarClock, Camera, ChevronLeft, ChevronRight, MapPin, Trash2 } from 'lucide-svelte';

  interface Person { id: string; name: string }
  interface Family { id: string; label: string }
  interface Image {
    id: string;
    caption: string | null;
    date: number;
    hex: string;
    includes: Person[];
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
    make: string | null;
    model: string | null;
    lens: string | null;
    isHDR: boolean;
    /** Used to reserve the right shape before the photo downloads. */
    width: number;
    height: number;
    capturedYear: number;
    capturedMonth: number;
    /** The capture date disagrees with the month it is filed in, and nobody has said it's fine. */
    misfiled: boolean;
  }

  interface Props {
    /** The photo being edited, or null when the dialog is closed. */
    image: Image | null;
    /** The month on screen, which is where this photo is currently filed. */
    year: number;
    month: number;
    people: Person[];
    families: Family[];
    /** Whether this user may edit or delete this photo. */
    canManage: boolean;
    /**
     * Why editing is off, when it is. A published year is frozen for everyone, so "uploaded
     * by someone else" would be plainly wrong for your own photo in one.
     */
    locked?: boolean;
    /**
     * Route this dialog is mounted under, used when a move carries you to the photo's new
     * month. The dialog posts to the page it is on, so both `/upload` and `/admin` work --
     * this only says where "the same photo, next month" lives.
     */
    basePath?: string;
    /** Group a person added from here should join. See PeoplePicker. */
    familyId?: string | null;
    onclose: () => void;
  }

  let {
    image,
    year,
    month,
    people,
    families,
    canManage,
    locked = false,
    basePath = '/upload',
    familyId = null,
    onclose
  }: Props = $props();

  // A stable id lets the Save button live outside the <form> it submits, which keeps the
  // "add someone new" form in PeoplePicker from being nested inside it -- HTML forbids that.
  const FORM_ID = 'photo-details-form';

  let selected = $state<string[]>([]);
  let caption = $state('');
  let saving = $state(false);
  /** Whether the full-size photo has arrived; until then the blurred thumbnail shows. */
  let loaded = $state(false);
  /** The same for the thumbnail, so it fades in rather than popping in over the tint. */
  let blurLoaded = $state(false);
  let blurEl = $state<HTMLImageElement | null>(null);
  let message = $state<string | null>(null);

  // Reset the draft whenever a different photo is opened.
  $effect(() => {
    if (image === null) return;
    loaded = false;
    blurLoaded = false;
    selected = image.includes.map((p) => p.id);
    caption = image.caption ?? '';
    message = null;
  });

  // A thumbnail already in cache can finish loading before the reset above clears the flag,
  // and a decoded image fires no second `load`, which would leave the placeholder stuck at
  // zero opacity. Re-reading `complete` once the new src is in the DOM covers that.
  $effect(() => {
    image?.id;
    if (blurEl !== null && blurEl.complete && blurEl.naturalWidth > 0) blurLoaded = true;
  });

  const open = $derived(image !== null);

  // A plain geo link: no tile provider, no API key, and nothing fetched from a third party
  // when the dialog opens. The OS hands it to whichever map app the viewer actually uses.
  const mapHref = (lat: number, lon: number) =>
    `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;

  const formatCoord = (lat: number, lon: number) =>
    `${Math.abs(lat).toFixed(5)}\u00b0${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}\u00b0${lon >= 0 ? 'E' : 'W'}`;

  // The 768px derivative keeps its gain map for HDR sources, so this is always the right
  // source -- HDR no longer costs a download of the multi-megabyte original.
  const showsHdr = $derived(image !== null && image.isHDR);
  const previewSrc = $derived(image === null ? '' : `/api/image/${image.id}/768`);
  /**
   * Candidates for the browser to choose between, paired with `sizes` below. The larger ones
   * only get picked on a pane wide enough to need them -- a big window on a high-density
   * display, where 1024 visibly upscales -- so smaller screens never pay for them.
   */
  const previewSrcset = $derived(image === null ? '' : srcsetFor(image.id, image.width, 768));

  /** Step a month, wrapping across the year boundary. */
  const step = (delta: number) => {
    const index = month - 1 + delta;
    return { year: year + Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
  };

  const previous = $derived(step(-1));
  const next = $derived(step(1));
  const label = (m: { year: number; month: number }) => monthsFull[m.month - 1] + ' ' + m.year;

  // Bound to the picker, reseeded from the month in view whenever a photo is opened.
  // Seeded in an effect rather than the initialiser, which would capture only the first
  // value of `year`/`month` and leave the picker stale after navigating months.
  let pickYear = $state(0);
  let pickMonth = $state(1);
  $effect.pre(() => {
    pickYear = year;
    pickMonth = month;
  });

  /**
   * Follow the photo to wherever it landed, rather than just closing. The action reports
   * the month it filed into, so you end up looking at the photo you just moved instead of
   * back where it used to be.
   */
  const moveHandler = () => async ({ result }: any) => {
    if (result.type === 'failure') {
      message = (result.data as { message?: string })?.message ?? 'Could not move';
      return;
    }

    const moved = result.type === 'success' ? result.data : null;
    const id = image?.id ?? null;

    if (typeof moved?.year === 'number' && typeof moved?.month === 'number' && id !== null) {
      // Navigate with the photo id in the URL and leave the dialog open: you stay on the
      // photo while the month around it changes. Closing first and reopening would flicker,
      // and fights the page's own URL-to-dialog syncing.
      await goto(`${basePath}/${moved.year}/${moved.month}?photo=${id}`, { invalidateAll: true });
      return;
    }

    onclose();
    await invalidateAll();
  };

  const capturedIn = $derived(
    image === null ? '' : `${monthsFull[image.capturedMonth - 1]} ${image.capturedYear}`
  );

  const camera = $derived(
    image === null ? null : [image.make, image.model].filter((v) => v !== null).join(' ') || null
  );
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => { if (!next) onclose(); }}
>
  <!-- p-0/gap-0 so the tinted column can reach the dialog edges; overflow-hidden clips it
       to the rounded corners. The padding moves onto each column instead. -->
  <!-- Widens with the screen so the photo gets the benefit of a big display, rather than
       sitting at one size with growing margins either side. -->
  <!-- Below `lg` the corner sits over the photograph, so the close button gets a scrim;
       from `lg` it is over the controls and reverts to the plain ghost button. -->
  <!-- Centred with `inset-0 m-auto` rather than the stock `left-1/2 + translate`: with a
       width that shrinks to its content, anchoring at 50% leaves only half the viewport as
       available space, so the dialog silently capped at half-width. -->
  <!-- Eases in more slowly than the app's other dialogs: this one is mostly a photograph,
       and the stock 100ms snap undersells it. Leaving is quicker than arriving, which is
       the usual asymmetry -- you have already decided to go. The backdrop is matched on
       both so the two move together. -->
  <Dialog.Content
    data-testid="photo-dialog"
    overlayClass="backdrop-filter-none data-open:duration-500 data-closed:duration-200"
    closeButtonClass="z-10 bg-black/55 text-white hover:bg-black/70 hover:text-white lg:bg-transparent lg:text-current lg:hover:bg-accent"
    class="max-h-[90dvh] gap-0 overflow-hidden p-0 data-open:duration-500 data-closed:duration-200 data-open:ease-out data-closed:ease-in lg:inset-0 lg:m-auto lg:h-[85dvh] lg:w-fit lg:max-w-[min(95vw,96rem)] lg:translate-x-0 lg:translate-y-0"
  >
    {#if image !== null}
      <!-- The photo column is `auto`: it takes whatever width the picture needs at full
           height, so the dialog shrinks to fit rather than padding the sides. The controls
           get a fixed column, since they stop benefiting from width quickly. -->
      <!-- This is the scroller on a phone, not the dialog itself: the close button is a
           child of the dialog, so anything that scrolls the dialog carries it off screen.
           From `lg` it stops scrolling and the controls column takes over. -->
      <div class="max-h-[90dvh] overflow-y-auto lg:h-full lg:max-h-none lg:overflow-hidden">
        <div class="grid lg:h-full lg:min-h-0 lg:grid-cols-[auto_22rem] xl:grid-cols-[auto_24rem]">
          <!-- Below `lg` this is a full-width band and the whole dialog scrolls as one, so a
               phone gets the picture edge to edge and can scroll past it to the controls.
               From `lg` it becomes the left column:
               Width comes from the photo's own shape at full height, so the picture never
               gets bars down its sides -- the dialog narrows instead. The cap leaves room for
               the controls column, otherwise this track refuses to shrink and squeezes it.
               A very wide photo hits that cap and gets bars top and bottom, which is fine. -->
          <div
            class="photo-pane relative w-full overflow-hidden border-b lg:h-full lg:w-auto lg:min-h-0 lg:max-w-[calc(95vw-22rem)] lg:min-w-[18rem] lg:border-r lg:border-b-0 xl:max-w-[calc(95vw-24rem)]"
            style="--tint: {image.hex}; --shape: {image.width} / {image.height}"
          >
            <!-- 128px thumbnail, blown up and blurred. It comes from the database rather
                 than the filesystem and is a couple of KB, so it is on screen almost at
                 once while the full-size photo downloads over the top of it. -->
            <img
              src="/api/image/{image.id}/128"
              alt=""
              aria-hidden="true"
              class="absolute inset-0 size-full scale-110 object-cover blur-2xl transition-opacity duration-300 {blurLoaded
                ? 'opacity-60'
                : 'opacity-0'}"
            />

            <!-- Sits exactly where the real photo will land -- same `object-contain`, same
                 box, no scale -- so the hand-off is a cross-fade, not a jump in framing. -->
            <img
              src="/api/image/{image.id}/128"
              alt=""
              aria-hidden="true"
              bind:this={blurEl}
              onload={() => (blurLoaded = true)}
              class="absolute inset-0 size-full object-contain blur-lg transition-opacity duration-300 {blurLoaded
                ? 'opacity-100'
                : 'opacity-0'}"
            />

            <!-- `sizes` must match the pane's real width rather than merely being close: the
                 browser lays a srcset image out at whatever `sizes` claims, because
                 naturalWidth is density-corrected against the chosen candidate. An
                 under-stated value visibly shrinks the photo. The pane is now the full
                 column with no padding: dialog x 1.6/2.6 at lg and up. -->
            <img
              src={previewSrc}
              srcset={previewSrcset}
              sizes="(min-width: 1536px) 72rem, (min-width: 1280px) 52rem, (min-width: 1024px) 39rem, 100vw"
              alt={image.caption ?? 'Uploaded photo'}
              data-testid="photo-full"
              onload={() => (loaded = true)}
              class="absolute inset-0 size-full object-contain transition-opacity duration-300 {loaded
                ? 'opacity-100'
                : 'opacity-0'}"
            />

            {#if showsHdr}
              <span
                title="This photo carries a gain map. It renders in HDR on a display that supports it, and normally everywhere else."
                class="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white"
              >
                HDR
              </span>
            {/if}
          </div>

          <!-- `[&>*]:shrink-0` is load-bearing: flex children shrink by default, so without
               it tall content compresses to fit instead of overflowing, and the column never
               scrolls -- the people list just gets squashed. -->
          <div class="flex flex-col gap-4 p-6 lg:min-h-0 lg:overflow-y-auto lg:[&>*]:shrink-0">
            <Dialog.Header class="pr-8">
              <Dialog.Title>Photo details</Dialog.Title>
              <Dialog.Description>
                Taken {dateToDateStringFormMonthDayYear(image.date)}
              </Dialog.Description>
            </Dialog.Header>

            <form
              id={FORM_ID}
              method="POST"
              action="?/details"
              use:enhance={() => {
                saving = true;
                return async ({ result, update }) => {
                  saving = false;
                  if (result.type === 'failure') {
                    message = (result.data as { message?: string })?.message ?? 'Could not save';
                  } else {
                    await update({ reset: false });
                    onclose();
                  }
                };
              }}
            >
              <input type="hidden" name="id" value={image.id} />

              <label for="caption" class="block text-sm font-medium text-gray-900 dark:text-white">
                Caption
              </label>
              <textarea
                id="caption"
                name="caption"
                data-testid="photo-caption"
                bind:value={caption}
                rows="2"
                disabled={!canManage}
                placeholder="Where was this?"
                class="mt-1 block w-full rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 disabled:opacity-60 dark:bg-white/5 dark:text-white dark:outline-white/10"
              ></textarea>

              <!-- The picker below only edits `selected`; these carry it into the submission. -->
              {#each selected as personId (personId)}
                <input type="hidden" name="people" value={personId} />
              {/each}
            </form>

            <div>
              <span class="block text-sm font-medium text-gray-900 dark:text-white">Who's in it</span>
              <p class="mt-0.5 mb-2 text-xs text-gray-500 dark:text-gray-400">
                {selected.length === 0 ? 'Nobody tagged yet' : `${selected.length} tagged`}
              </p>
              <!-- Read-only when this photo cannot be edited: another group's, or a year
                   that has been published. -->
              <PeoplePicker {people} {families} {familyId} disabled={!canManage} bind:selected />
            </div>

            {#if canManage}
              <div>
                <span class="block text-sm font-medium text-gray-900 dark:text-white">Filed under</span>
                <div class="mt-1.5 flex items-center gap-1.5">
                  <form method="POST" action="?/moveToMonth" use:enhance={moveHandler}>
                    <input type="hidden" name="id" value={image.id} />
                    <input type="hidden" name="year" value={previous.year} />
                    <input type="hidden" name="month" value={previous.month} />
                    <button
                      type="submit"
                      data-testid="move-prev"
                      title="Move to {label(previous)}"
                      aria-label="Move to {label(previous)}"
                      class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <ChevronLeft class="size-4" />
                    </button>
                  </form>

                  <span class="grow text-center text-sm text-gray-700 dark:text-gray-300">
                    {label({ year, month })}
                  </span>

                  <form method="POST" action="?/moveToMonth" use:enhance={moveHandler}>
                    <input type="hidden" name="id" value={image.id} />
                    <input type="hidden" name="year" value={next.year} />
                    <input type="hidden" name="month" value={next.month} />
                    <button
                      type="submit"
                      data-testid="move-next"
                      title="Move to {label(next)}"
                      aria-label="Move to {label(next)}"
                      class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <ChevronRight class="size-4" />
                    </button>
                  </form>
                </div>

                <!-- The arrows cover the common nudge; this covers everything else. -->
                <form method="POST" action="?/moveToMonth" use:enhance={moveHandler} class="mt-1.5 flex gap-1.5">
                  <input type="hidden" name="id" value={image.id} />
                  <select
                    name="month"
                    bind:value={pickMonth}
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
                    bind:value={pickYear}
                    aria-label="Year"
                    class="w-20 rounded-md bg-white px-2 py-1 text-xs text-gray-900 outline-1 -outline-offset-1 outline-gray-300 dark:bg-white/5 dark:text-white dark:outline-white/10"
                  />
                  <button
                    type="submit"
                    data-testid="move-apply"
                    disabled={pickYear === year && pickMonth === month}
                    class="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                  >
                    Move
                  </button>
                </form>
              </div>
            {/if}

            {#if image.misfiled}
              <div class="rounded-lg bg-amber-50 p-2.5 outline outline-amber-200 dark:bg-amber-500/10 dark:outline-amber-500/20">
                <p class="flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-200">
                  <CalendarClock class="mt-0.5 size-3.5 shrink-0" />
                  <span>This photo was taken in <strong>{capturedIn}</strong>.</span>
                </p>

                {#if canManage}
                  <div class="mt-2 flex flex-wrap gap-2">
                    <!-- Sibling forms, not nested: both live outside the details form above. -->
                    <form
                      method="POST"
                      action="?/refile"
                      use:enhance={moveHandler}
                    >
                      <input type="hidden" name="id" value={image.id} />
                      <button type="submit" class="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-500">
                        Move to {capturedIn}
                      </button>
                    </form>

                    <form
                      method="POST"
                      action="?/dismissDateWarning"
                      use:enhance={() => async ({ result, update }) => {
                        if (result.type === 'failure') {
                          message = (result.data as { message?: string })?.message ?? 'Could not dismiss';
                        } else {
                          await update({ reset: false });
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={image.id} />
                      <button
                        type="submit"
                        title="Keep this photo in this month and stop showing the warning"
                        class="rounded-md px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-500/20"
                      >
                        Dismiss
                      </button>
                    </form>
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Read straight off the file at upload; not editable here. -->
            {#if image.latitude !== null && image.longitude !== null}
              <div class="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <MapPin class="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <a
                    href={mapHref(image.latitude, image.longitude)}
                    target="_blank"
                    rel="noreferrer noopener"
                    class="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {formatCoord(image.latitude, image.longitude)}
                  </a>
                  {#if image.altitude !== null}
                    <span class="text-gray-400"> &middot; {Math.round(image.altitude)}&thinsp;m</span>
                  {/if}
                </span>
              </div>
            {/if}

            {#if camera !== null}
              <div class="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <Camera class="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {camera}
                  {#if image.lens !== null}<span class="text-gray-400"> &middot; {image.lens}</span>{/if}
                </span>
              </div>
            {/if}

            {#if message !== null}
              <p class="text-sm text-red-600 dark:text-red-400">{message}</p>
            {/if}
            <Dialog.Footer class="mt-auto flex-row items-center justify-between gap-2 pt-2 sm:justify-between">
              {#if canManage}
                <form
                  method="POST"
                  action="?/delete"
                  use:enhance={() => async ({ result, update }) => {
                    if (result.type === 'failure') {
                      message = (result.data as { message?: string })?.message ?? 'Could not delete';
                    } else {
                      await update({ reset: false });
                      onclose();
                    }
                  }}
                >
                  <input type="hidden" name="id" value={image.id} />
                  <button
                    type="submit"
                    data-testid="photo-delete"
                    class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    <Trash2 class="size-4" /> Delete
                  </button>
                </form>
              {:else}
                <span class="text-xs text-gray-400">
                  {locked ? 'Published \u2014 unpublish the year to edit' : 'Uploaded by someone else'}
                </span>
              {/if}

              <div class="flex gap-2">
                <button
                  type="button"
                  data-testid="photo-cancel"
                  onclick={onclose}
                  class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="photo-save"
              form={FORM_ID}
                  disabled={!canManage || saving}
                  class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                  </div>
            </Dialog.Footer>
            </div>
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  /*
   * Tint the photo half with the image's own average colour so it reads as a separate
   * surface from the controls. Mixed heavily toward the page background rather than used
   * neat: at full strength a saturated photo overwhelms the dialog, and a dark photo on
   * the dark theme would vanish into it.
   */
  .photo-pane {
    /*
     * Works in both directions. On a phone the pane is full width, so this gives it the
     * photo's height; on a wide screen the height is fixed by the dialog, so it gives the
     * width. Either way the box matches the picture and no bars appear.
     */
    aspect-ratio: var(--shape);
  }

  .photo-pane {
    /*
     * Three declarations, weakest first; the last one the browser understands wins.
     *
     * Averaging a photograph cancels most of its chroma, so the stored colour is always
     * duller than the picture looks. Mixing more of that dull colour in only makes the
     * panel muddy -- the chroma has to be pushed back up. Relative colour syntax does
     * that directly, clamping lightness so the panel stays behind the photo rather than
     * competing with it, and capping chroma so a vivid picture cannot produce a garish
     * slab.
     */
    background-color: var(--color-gray-100, #f3f4f6);
    background-color: color-mix(in oklab, var(--tint) 30%, #fff);
    background-color: oklch(from var(--tint) clamp(0.74, l, 0.9) min(calc(c * 3), 0.13) h);

    /* One divider on the edge it shares with the controls -- a full outline would draw a
       box inside the dialog, which is exactly the inset card this replaced. */
    border-color: color-mix(in oklab, var(--tint) 30%, transparent);
    border-color: oklch(from var(--tint) clamp(0.6, l, 0.82) min(calc(c * 3), 0.14) h);
  }

  /*
   * Anchored to a grey above the dialog's own surface rather than to black. Mixing toward
   * black put a mid-grey photo at almost exactly the dialog's lightness, so the division
   * this is here to draw disappeared for any photo that was not already dark.
   */
  :global(.dark) .photo-pane {
    background-color: var(--color-gray-800, #1f2937);
    background-color: color-mix(in oklab, var(--tint) 32%, #2a2a2a);
    background-color: oklch(from var(--tint) clamp(0.26, l, 0.42) min(calc(c * 3), 0.13) h);

    border-color: color-mix(in oklab, var(--tint) 40%, transparent);
    border-color: oklch(from var(--tint) clamp(0.34, l, 0.5) min(calc(c * 3), 0.14) h);
  }
</style>
