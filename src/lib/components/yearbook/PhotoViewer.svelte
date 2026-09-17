<script lang="ts">
  /**
   * Full-screen viewer for a yearbook photo.
   *
   * Built as a filmstrip rather than a single swapped image. Three slides exist at a time --
   * the one before, the one on screen, the one after -- each positioned by how far it is from
   * the current index. Moving is then a matter of changing that index and letting one CSS
   * transition carry every slide across, which is what makes a drag and a button press the
   * same motion.
   *
   * It advances immediately and never waits on the network. Each slide shows the 128px
   * thumbnail -- a database blob, on screen within a frame -- blown up and blurred, with the
   * full photograph fading in over it once decoded. An earlier version held the previous photo
   * until the next had decoded, which read as the viewer locking up on a large file.
   *
   * Deliberately free of `backdrop-filter`. An element that samples its backdrop forces that
   * backdrop to be rasterised, and Safari composites the resulting group in SDR -- which
   * tone-maps an HDR photograph sitting inside it.
   *
   * It walks the whole year in reading order, not just the row that was clicked, so paging
   * from a photo in August carries straight on into September.
   */
  import { ChevronLeft, ChevronRight, X } from 'lucide-svelte';
  import { srcsetFor } from '$lib/image';

  interface ViewerPhoto {
    id: string;
    caption: string | null;
    hex: string;
    width: number;
    height: number;
  }

  interface Props {
    /** Every photo in the year, in reading order. */
    photos: ViewerPhoto[];
    /** Index of the photo on show, or null when the viewer is closed. Bound. */
    index: number | null;
    onclose: () => void;
  }

  let { photos, index = $bindable(), onclose }: Props = $props();

  const current = $derived(index === null ? null : (photos[index] ?? null));
  const hasPrev = $derived(index !== null && index > 0);
  const hasNext = $derived(index !== null && index < photos.length - 1);

  /**
   * The slides that exist in the DOM: the current one and its immediate neighbours.
   *
   * Keyed by photo id in the markup, so when the index moves the slide that was "next"
   * survives as the new "current" rather than being torn down and rebuilt. That survival is
   * what lets the browser animate it -- a replaced node has nowhere to animate from.
   */
  const windowed = $derived(
    index === null
      ? []
      : [index - 1, index, index + 1]
          .filter((i) => i >= 0 && i < photos.length)
          .map((i) => ({ i, photo: photos[i] }))
  );

  /** Full-size photographs that have decoded and started fading in. */
  let loaded = $state<Record<string, boolean>>({});

  /**
   * Photographs whose fade-in has finished, at which point the placeholder can go.
   *
   * Removing the placeholder the moment the photograph *starts* fading left 300ms where a
   * half-transparent photograph sat over the black backdrop -- a flash of dark between the
   * blurry image and the sharp one. The placeholder now stays underneath until the fade is done.
   */
  let faded = $state<Record<string, boolean>>({});

  const reveal = (id: string, image: HTMLImageElement) => {
    // `load` does not mean ready to paint, and `decoding="async"` makes that gap real: fading
    // in an undecoded image fades in a blank. Wait for the bitmap first.
    const ready = image.decode?.() ?? Promise.resolve();
    ready
      .catch(() => {})
      .then(() => {
        loaded[id] = true;
        // `transitionend` normally clears the placeholder; this covers reduced motion, where
        // there is no transition to end, and any transition that gets interrupted. Long enough
        // to sit safely beyond the fade plus the grace period below.
        setTimeout(() => (faded[id] = true), 1400);
      });
  };

  /**
   * The shape the browser actually decoded, per photo.
   *
   * Not the stored `width`/`height`: some files keep an EXIF orientation tag rather than having
   * it baked in, so a portrait photograph can be recorded as 4032x3024 while displaying as
   * 3024x4032. A box built from the stored numbers would crop it hard. The decoded
   * `naturalWidth`/`naturalHeight` already honour the orientation, so they are the truth once
   * either image has loaded; the stored numbers are only the first guess.
   */
  let shapes = $state<Record<string, string>>({});

  const measure = (id: string, image: HTMLImageElement, authoritative: boolean) => {
    if (image.naturalWidth === 0 || image.naturalHeight === 0) return;
    // The placeholder may answer first; the full image overrides it, never the reverse.
    if (!authoritative && shapes[id] !== undefined) return;
    shapes[id] = `${image.naturalWidth} / ${image.naturalHeight}`;
  };

  /** Live finger offset in pixels. Zero whenever a drag is not in progress. */
  let drag = $state(0);
  /** Suppresses the transition while a finger is down, so the strip tracks the finger. */
  let dragging = $state(false);

  const step = (delta: number) => {
    if (index === null) return;
    const next = index + delta;
    if (next < 0 || next >= photos.length) return;
    index = next;
  };

  /**
   * Arrow keys page, Escape closes.
   *
   * Bound to the window rather than the dialog so it works without having to think about
   * what has focus -- the viewer is modal, so there is nothing else these keys could mean.
   */
  const onkeydown = (event: KeyboardEvent) => {
    if (index === null) return;
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'Escape') onclose();
    else return;
    event.preventDefault();
  };

  /**
   * Decode the neighbours ahead of time.
   *
   * Done programmatically rather than with hidden `<img>` elements: a `display: none` image is
   * downloaded but not decoded, and decoding a 4032px photo is the slow half. This no longer
   * gates anything -- the slide moves regardless -- it just means the photograph is usually
   * already there when it arrives.
   */
  $effect(() => {
    if (index === null) return;

    const handles = [photos[index - 1], photos[index + 1]]
      .filter((photo) => photo !== undefined)
      .map((photo) => {
        const image = new Image();
        image.srcset = srcsetFor(photo.id, photo.width, 768);
        image.sizes = '100vw';
        image.src = `/api/image/${photo.id}/2048`;
        image.decode?.().catch(() => {});
        return image;
      });

    return () => {
      handles.length = 0;
    };
  });

  /**
   * Freeze the page behind the viewer while it is open.
   *
   * `overflow: hidden` on the root, not `position: fixed` on the body. Pinning the body made
   * iOS Safari treat the page as scrolled back to the top, so a toolbar that had collapsed
   * while reading came back -- shrinking the viewport just after the viewer opened and
   * nudging the centred photograph upward. Touches cannot scroll the page anyway: the viewer
   * covers the whole screen with `touch-action: none` and `overscroll-behavior: contain`. This
   * only has to stop a mouse wheel or keyboard reaching the page behind.
   *
   * Keyed on open/closed rather than on `index`, so paging between photos does not unlock
   * and relock the page on every step.
   */
  const open = $derived(index !== null);

  $effect(() => {
    if (!open) return;

    const roots = [document.documentElement, document.body];
    const previous = roots.map((el) => ({
      overflow: el.style.overflow,
      overscroll: el.style.overscrollBehavior
    }));

    for (const el of roots) {
      el.style.overflow = 'hidden';
      el.style.overscrollBehavior = 'none';
    }

    return () => {
      roots.forEach((el, i) => {
        el.style.overflow = previous[i].overflow;
        el.style.overscrollBehavior = previous[i].overscroll;
      });
    };
  });

  // ---------------------------------------------------------------------------------------
  // Touch: swipe to page, pinch to zoom, drag to pan, double-tap to toggle
  // ---------------------------------------------------------------------------------------
  //
  // The page itself cannot be pinch-zoomed at mobile sizes (see app.html), so zoom here is
  // done by the viewer rather than the browser: a CSS scale on the photograph on screen. That
  // is what lets the photo zoom while the interface around it stays put.
  //
  // One gesture owns the touch at a time. Two fingers always mean pinch. One finger means
  // pan while zoomed in, and swipe-to-page only at 1x -- otherwise dragging around a zoomed
  // photo would keep flicking to the next one.

  const MAX_ZOOM = 4;
  const DOUBLE_TAP_ZOOM = 2.5;

  /** Scale of the photograph on screen. 1 is fitted. */
  let zoom = $state(1);
  /** Offset of the zoomed photograph from centre, in screen pixels. */
  let panX = $state(0);
  let panY = $state(0);
  /** True while fingers are moving the zoom or pan, so the transform tracks them directly. */
  let gesturing = $state(false);

  const resetZoom = () => {
    zoom = 1;
    panX = 0;
    panY = 0;
  };

  // A new photograph always arrives fitted, whichever way it was reached.
  $effect(() => {
    index;
    resetZoom();
  });

  /** The on-screen photograph's box, unscaled -- measured at gesture start. */
  let baseW = 1;
  let baseH = 1;

  const measureBox = () => {
    const box = document.querySelector<HTMLElement>(
      '[data-testid=viewer-slide][data-current="true"] .box'
    );
    if (box === null) return;
    const rect = box.getBoundingClientRect();
    baseW = rect.width / zoom;
    baseH = rect.height / zoom;
  };

  /**
   * Keep a zoomed photograph covering the screen where it can. Panning is allowed only as far
   * as there is photograph to reveal; once an edge reaches the screen's edge it stops there.
   */
  const clampPan = (x: number, y: number, scale: number) => {
    const maxX = Math.max(0, (baseW * scale - window.innerWidth) / 2);
    const maxY = Math.max(0, (baseH * scale - window.innerHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y))
    };
  };

  let mode: 'swipe' | 'pan' | 'pinch' | null = null;

  let startX = 0;
  let startY = 0;
  /** Null until the first movement decides whether a 1x drag is horizontal or vertical. */
  let axis: 'x' | 'y' | null = null;
  let width = $state(1);

  let pinchStartDist = 1;
  let pinchStartZoom = 1;
  let pinchStartPanX = 0;
  let pinchStartPanY = 0;
  let pinchStartMidX = 0;
  let pinchStartMidY = 0;

  let panStartX = 0;
  let panStartY = 0;

  let lastTapAt = 0;
  let tapMoved = false;
  /** Set once a second finger has touched during this gesture, so it can never read as a tap. */
  let sawMultitouch = false;
  /** When the last touch ended, so the backdrop can ignore the click a browser sends after it. */
  let lastTouchEndAt = 0;

  /** When the current swipe began, for telling a quick flick from a slow drag. */
  let swipeStartedAt = 0;

  const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const beginPinch = (touches: TouchList) => {
    sawMultitouch = true;
    measureBox();
    mode = 'pinch';
    gesturing = true;
    drag = 0;
    dragging = false;
    pinchStartDist = Math.max(1, distance(touches[0], touches[1]));
    pinchStartZoom = zoom;
    pinchStartPanX = panX;
    pinchStartPanY = panY;
    pinchStartMidX = (touches[0].clientX + touches[1].clientX) / 2;
    pinchStartMidY = (touches[0].clientY + touches[1].clientY) / 2;
  };

  /**
   * A touch that began on a control (the close button, the arrows) is left entirely to the
   * browser. Gesture handling cancels the synthesized click on a tap -- that is how a tap on
   * a zoomed photograph avoids closing the viewer -- and doing that to a button means the
   * button never works. The full-screen backdrop is also a button, but it is the thing taps
   * are meant to be kept away from, so it is not a control here.
   */
  let onControl = false;

  const startedOnControl = (event: TouchEvent) => {
    const target = event.target as Element | null;
    const button = target?.closest('button, a');
    return button !== null && button !== undefined && !button.hasAttribute('data-backdrop');
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 1 && startedOnControl(event)) {
      onControl = true;
      return;
    }
    onControl = false;

    if (event.touches.length >= 2) {
      beginPinch(event.touches);
      return;
    }

    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    tapMoved = false;
    sawMultitouch = false;
    width = window.innerWidth || 1;

    if (zoom > 1.01) {
      measureBox();
      mode = 'pan';
      gesturing = true;
      panStartX = panX;
      panStartY = panY;
    } else {
      mode = 'swipe';
      axis = null;
      dragging = true;
      swipeStartedAt = performance.now();
    }
  };

  const onTouchMove = (event: TouchEvent) => {
    if (onControl) return;

    // A second finger arriving mid-swipe turns the gesture into a pinch.
    if (event.touches.length >= 2) {
      if (mode !== 'pinch') beginPinch(event.touches);

      const [a, b] = [event.touches[0], event.touches[1]];
      const scale = Math.min(
        MAX_ZOOM,
        Math.max(1, pinchStartZoom * (distance(a, b) / pinchStartDist))
      );
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;

      // Zoom about the point between the fingers, not the middle of the screen: the part of
      // the photo you pinched on stays under your fingers. `focal` is that point in the
      // photograph's own unscaled coordinates, measured from its centre.
      const centreX = window.innerWidth / 2;
      const centreY = window.innerHeight / 2;
      const focalX = (pinchStartMidX - centreX - pinchStartPanX) / pinchStartZoom;
      const focalY = (pinchStartMidY - centreY - pinchStartPanY) / pinchStartZoom;

      const clamped = clampPan(
        midX - centreX - focalX * scale,
        midY - centreY - focalY * scale,
        scale
      );
      zoom = scale;
      panX = clamped.x;
      panY = clamped.y;
      tapMoved = true;
      event.preventDefault();
      return;
    }

    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) tapMoved = true;

    if (mode === 'pan') {
      const clamped = clampPan(panStartX + dx, panStartY + dy, zoom);
      panX = clamped.x;
      panY = clamped.y;
      event.preventDefault();
      return;
    }

    if (mode !== 'swipe' || !dragging) return;

    // Decide the axis once, from the first movement big enough to mean anything. Without
    // this a slightly diagonal swipe flickers between panning and doing nothing.
    if (axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }

    if (axis !== 'x') return;

    // Past either end there is nothing to reveal, so the strip is made to feel stiff rather
    // than dragging an empty frame into view.
    drag = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext) ? dx * 0.25 : dx;


    event.preventDefault();
  };

  const onTouchEnd = (event: TouchEvent) => {
    // Let the button's own click through, untouched.
    if (onControl) {
      if (event.touches.length === 0) onControl = false;
      return;
    }

    // Lifting one finger of a pinch leaves a pan with the other, from where it now is.
    if (mode === 'pinch' && event.touches.length === 1) {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      panStartX = panX;
      panStartY = panY;
      mode = zoom > 1.01 ? 'pan' : null;
      return;
    }
    if (event.touches.length > 0) return;

    if (mode === 'swipe') {
      // Two ways to turn the page, like a native photo browser:
      //
      // - drag far enough: a tenth of the screen, with a floor so a twitch does not count.
      //   (It was a quarter, which asked for a long, deliberate swipe.)
      // - or flick: any swipe that is over quickly counts once it has moved a little.
      //
      // The flick rule is deliberately about the whole gesture's duration rather than the
      // finger's speed at release. Browsers coalesce touch events -- a fast swipe may arrive
      // as four or five samples -- and a real finger often slows just before lifting, so a
      // release-velocity test misses exactly the quick swipes it exists for.
      const distanceThreshold = Math.max(36, width * 0.1);
      const quick = performance.now() - swipeStartedAt < 300 && Math.abs(drag) > 20;

      if ((drag <= -distanceThreshold || (quick && drag < 0)) && hasNext) step(1);
      else if ((drag >= distanceThreshold || (quick && drag > 0)) && hasPrev) step(-1);
      drag = 0;
      dragging = false;
      axis = null;
    }

    // Nearly back to fitted is fitted: settling at 1.03x just looks slightly wrong.
    if (zoom < 1.05) resetZoom();

    // No touch the gesture code handled is allowed to become a click.
    //
    // Closing used to rely on the browser turning a tap on the dark surround into a click on
    // the full-screen backdrop button. But the browser makes that call, not this code, and it
    // would sometimes make it for a swipe that happened to start or finish off the photograph
    // -- closing the viewer mid-swipe. So the synthesized click is always cancelled here, and
    // closing is decided below from what the finger actually did.
    event.preventDefault();
    lastTouchEndAt = performance.now();

    const end = event.changedTouches[0];
    const box = document
      .querySelector('[data-testid=viewer-slide][data-current="true"] .box')
      ?.getBoundingClientRect();
    const onPhoto = (x: number, y: number) =>
      box !== undefined && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

    // Close only on an unmistakable tap on the surround: one finger, no movement to speak of,
    // not zoomed in, and both the start *and* the end off the photograph. Anything short of
    // all of that is some other gesture and leaves the viewer open.
    const isTap = !tapMoved && !sawMultitouch && mode !== 'pinch';
    if (
      isTap &&
      zoom <= 1.01 &&
      end !== undefined &&
      !onPhoto(startX, startY) &&
      !onPhoto(end.clientX, end.clientY)
    ) {
      gesturing = false;
      mode = null;
      onclose();
      return;
    }

    // Double-tap: zoom in on the tapped point, or back out.
    if (isTap && onPhoto(startX, startY)) {
      const now = performance.now();
      if (now - lastTapAt < 300) {
        lastTapAt = 0;
        if (zoom > 1.01) {
          resetZoom();
        } else {
          measureBox();
          const tapX = startX - window.innerWidth / 2;
          const tapY = startY - window.innerHeight / 2;
          const clamped = clampPan(-tapX * (DOUBLE_TAP_ZOOM - 1), -tapY * (DOUBLE_TAP_ZOOM - 1), DOUBLE_TAP_ZOOM);
          zoom = DOUBLE_TAP_ZOOM;
          panX = clamped.x;
          panY = clamped.y;
        }
      } else {
        lastTapAt = now;
      }
    }

    gesturing = false;
    mode = null;
  };
</script>

<svelte:window {onkeydown} />

{#if current !== null && index !== null}
  <!-- Locks the page behind it, so scrolling here does not scroll the book. -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Photograph viewer"
    tabindex="-1"
    class="fixed inset-0 z-50 touch-none overflow-hidden overscroll-contain"
    data-testid="photo-viewer"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
    ontouchcancel={onTouchEnd}
  >
    <button
      type="button"
      aria-label="Close viewer"
      onclick={(event) => {
        // Touch closes are decided in `onTouchEnd`. A click arriving just after a touch is the
        // browser's synthesized echo of it, and acting on that is what closed the viewer when
        // a swipe strayed off the photograph.
        if (performance.now() - lastTouchEndAt < 800) return;

        // The slides above this button are `pointer-events: none` (so a drag anywhere reaches
        // the gesture handlers), which means a click *on the photograph* lands here too. Only
        // the dark surround should close; the photograph is for looking at. The box's rect
        // includes any zoom, so a click anywhere on a zoomed photo is ignored as well.
        const box = document
          .querySelector('[data-testid=viewer-slide][data-current="true"] .box')
          ?.getBoundingClientRect();
        if (
          box !== undefined &&
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom
        ) {
          return;
        }

        onclose();
      }}
      data-backdrop
      class="viewer-backdrop absolute inset-0 cursor-default bg-black/95"
    ></button>

    {#each windowed as slide (slide.photo.id)}
      <!-- Position is a function of distance from the current index, so changing the index
           moves every slide at once and the drag offset rides on top of it. -->
      <figure
        class="slide pointer-events-none absolute inset-0"
        class:dragging
        data-testid="viewer-slide"
        data-current={slide.i === index}
        style="--from: {slide.i - index}; --drag: {drag}px"
      >
        <!-- A box with the photograph's exact shape, fitted to the screen. Both images fill
             it and it clips them, so nothing can spill past the photo's own edges -- that
             spill is what used to read as a glow around it.

             The placeholder has no CSS blur. A full-screen `filter: blur()` is one of the
             most expensive things a phone's compositor can be asked to animate, and it was
             riding along on every slide. A 128px image stretched to the screen is already
             soft; it just is not smeared. It is removed entirely once the photograph has
             loaded, so a settled slide is one layer rather than two. -->
        <div class="frame">
          <div
            class="box"
            class:gesturing={slide.i === index && gesturing}
            class:measured={shapes[slide.photo.id] !== undefined}
            data-zoom={slide.i === index ? zoom : 1}
            style="--ar: {shapes[slide.photo.id] ??
              `${slide.photo.width} / ${slide.photo.height}`}; --zoom: {slide.i === index
              ? zoom
              : 1}; --pan-x: {slide.i === index ? panX : 0}px; --pan-y: {slide.i === index
              ? panY
              : 0}px"
          >
            {#if !faded[slide.photo.id]}
              <img
                src="/api/image/{slide.photo.id}/128"
                alt=""
                aria-hidden="true"
                decoding="async"
                onload={(event) => measure(slide.photo.id, event.currentTarget as HTMLImageElement, false)}
                data-testid="viewer-placeholder"
                class="absolute inset-0 size-full object-cover"
              />
            {/if}

            <img
              src="/api/image/{slide.photo.id}/2048"
              srcset={srcsetFor(slide.photo.id, slide.photo.width, 768)}
              sizes="100vw"
              alt={slide.photo.caption ?? 'Photograph'}
              decoding="async"
              data-testid={slide.i === index ? 'viewer-image' : 'viewer-image-off'}
              onload={(event) => {
                const image = event.currentTarget as HTMLImageElement;
                measure(slide.photo.id, image, true);
                reveal(slide.photo.id, image);
              }}
              ontransitionend={(event) => {
                if (event.propertyName !== 'opacity' || !loaded[slide.photo.id]) return;
                // Not removed the instant the fade reports finished. `transitionend` fires on
                // the main thread when the *style* reaches opacity 1, which can be a frame or
                // more ahead of the compositor actually painting it -- longer for a large HDR
                // photograph whose texture is still being uploaded. Removing the placeholder in
                // that window still showed an occasional flash of black. Kept under an already
                // opaque photo it is invisible, so the margin is generous.
                const id = slide.photo.id;
                setTimeout(() => (faded[id] = true), 700);
              }}
              class="absolute inset-0 size-full object-cover transition-opacity duration-300 {loaded[
                slide.photo.id
              ]
                ? 'opacity-100'
                : 'opacity-0'}"
            />
          </div>
        </div>
      </figure>
    {/each}

    {#if current.caption !== null && current.caption.trim() !== ''}
      <p
        class="caption pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-6 pt-16 pb-[calc(env(safe-area-inset-bottom)_+_2rem)] text-center text-sm leading-relaxed text-white/90 sm:text-base"
        data-testid="viewer-caption"
      >
        <span class="mx-auto block max-w-2xl">{current.caption}</span>
      </p>
    {/if}

    <!-- Controls sit above the photo but never over its middle. -->
    <button
      type="button"
      onclick={onclose}
      aria-label="Close viewer"
      data-testid="viewer-close"
      class="absolute top-[calc(env(safe-area-inset-top)_+_1rem)] right-[calc(env(safe-area-inset-right)_+_1rem)] rounded-full bg-white/15 p-2.5 text-white transition hover:bg-white/25"
    >
      <X class="size-5" />
    </button>

    <p
      class="absolute top-[calc(env(safe-area-inset-top)_+_1.6rem)] left-[calc(env(safe-area-inset-left)_+_1.5rem)] text-xs tracking-[0.2em] text-white/50 tabular-nums"
      data-testid="viewer-position"
    >
      {index + 1} / {photos.length}
    </p>

    {#if hasPrev}
      <button
        type="button"
        onclick={() => step(-1)}
        aria-label="Previous photograph"
        data-testid="viewer-prev"
        class="absolute top-1/2 left-[calc(env(safe-area-inset-left)_+_0.5rem)] -translate-y-1/2 rounded-full bg-white/15 p-3 text-white transition hover:bg-white/25 sm:left-[calc(env(safe-area-inset-left)_+_1.25rem)]"
      >
        <ChevronLeft class="size-6" />
      </button>
    {/if}

    {#if hasNext}
      <button
        type="button"
        onclick={() => step(1)}
        aria-label="Next photograph"
        data-testid="viewer-next"
        class="absolute top-1/2 right-[calc(env(safe-area-inset-right)_+_0.5rem)] -translate-y-1/2 rounded-full bg-white/15 p-3 text-white transition hover:bg-white/25 sm:right-[calc(env(safe-area-inset-right)_+_1.25rem)]"
      >
        <ChevronRight class="size-6" />
      </button>
    {/if}
  </div>
{/if}

<style>
  .caption {
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman',
      serif;
    font-style: italic;
  }

  /*
   * Each slide sits one screen-width away per step from the current one, plus whatever the
   * finger has dragged. The gap keeps neighbouring photographs from touching while sliding.
   *
   * `translate3d` rather than `translateX`: it keeps the slide on the compositor, so a drag
   * follows the finger instead of waiting on layout.
   */
  .slide {
    transform: translate3d(calc(var(--from) * (100% + 2rem) + var(--drag)), 0, 0);
    transition: transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1);
    will-change: transform;
  }

  /* Centres the photo-shaped box in the screen. */
  .frame {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /*
   * Contain-fit without `object-contain`: the box is as wide as the screen allows, or as wide
   * as the screen's height times the photo's ratio, whichever is smaller -- so it always has
   * the photograph's exact proportions and never bars. `aspect-ratio` then sets the height.
   * `dvh` so the mobile address bar coming and going does not crop it.
   */
  .box {
    position: relative;
    aspect-ratio: var(--ar);
    width: min(100%, calc(100dvh * (var(--ar))));
    overflow: hidden;
    transform: translate3d(var(--pan-x, 0px), var(--pan-y, 0px), 0) scale(var(--zoom, 1));
    /* Eases a double-tap or the snap back to fitted; switched off while fingers are moving. */
    transition:
      transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1),
      opacity 160ms ease-out;
    /*
     * Hidden until a real shape is known. The stored dimensions are only a guess -- a photo
     * with an EXIF rotation is recorded landscape but displays portrait -- and showing the
     * box at the guess meant it opened at one size and then visibly jumped to another. The
     * placeholder is a couple of kB, so the wait is a frame or two.
     */
    opacity: 0;
  }

  .box.measured {
    opacity: 1;
  }

  .box.gesturing {
    transition: opacity 160ms ease-out;
  }

  /* While a finger is down the strip must track it exactly; any easing reads as lag. */
  .slide.dragging {
    transition: none;
  }

  .viewer-backdrop {
    animation: fade 200ms ease-out;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .slide,
    .box {
      transition: none;
    }

    .viewer-backdrop {
      animation: none;
    }
  }
</style>
