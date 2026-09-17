<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';

  /**
   * Frame a square crop for a profile picture.
   *
   * The rectangle is reported as fractions of the image rather than pixels, so the server
   * can apply it to the full-resolution original no matter what size was shown here.
   *
   * The picture shown is the `uncropped` rendering, never a derivative: derivatives are
   * built *from* the current crop, so framing against one would compound every time
   * somebody reframed. It is also decoded server-side, which is what makes this work for
   * HEIC -- browsers other than Safari cannot display those at all.
   */
  export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface Props {
    /** The stored image to frame, or null when closed. */
    imageId: string | null;
    /** Whose picture it is, shown in the title. */
    name?: string | null;
    /** Existing crop to start from, if there is one. */
    initial?: Rect | null;
    saving?: boolean;
    onapply: (rect: Rect) => void;
    oncancel: () => void;
  }

  let { imageId, name = null, initial = null, saving = false, onapply, oncancel }: Props = $props();

  let frame = $state<HTMLDivElement | null>(null);
  let natural = $state({ width: 0, height: 0 });

  // Selection in fractions of the image: `side` is the square's size as a fraction of the
  // shorter edge, `x`/`y` its top-left corner.
  let side = $state(0.8);
  let x = $state(0.1);
  let y = $state(0.1);

  /** Square in pixels means different fractions on each axis unless the image is square. */
  const aspect = $derived(natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1);
  const widthFrac = $derived(aspect >= 1 ? side / aspect : side);
  const heightFrac = $derived(aspect >= 1 ? side : side * aspect);

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

  $effect(() => {
    if (imageId === null) return;
    if (initial !== null) {
      side = aspect >= 1 ? initial.height : initial.width;
      x = initial.x;
      y = initial.y;
    } else {
      side = 0.8;
      x = (1 - (aspect >= 1 ? 0.8 / aspect : 0.8)) / 2;
      y = (1 - (aspect >= 1 ? 0.8 : 0.8 * aspect)) / 2;
    }
  });

  // Keep the square inside the picture whenever it is resized.
  $effect(() => {
    x = clamp(x, 0, Math.max(0, 1 - widthFrac));
    y = clamp(y, 0, Math.max(0, 1 - heightFrac));
  });

  let dragging = $state(false);
  let origin = { pointerX: 0, pointerY: 0, x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent) => {
    if (frame === null) return;
    dragging = true;
    origin = { pointerX: e.clientX, pointerY: e.clientY, x, y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || frame === null) return;
    const box = frame.getBoundingClientRect();
    x = clamp(origin.x + (e.clientX - origin.pointerX) / box.width, 0, 1 - widthFrac);
    y = clamp(origin.y + (e.clientY - origin.pointerY) / box.height, 0, 1 - heightFrac);
  };

  const onPointerUp = () => (dragging = false);

  /** Arrow keys nudge the square, so this does not need a pointing device. */
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => (x = clamp(x - step, 0, 1 - widthFrac)),
      ArrowRight: () => (x = clamp(x + step, 0, 1 - widthFrac)),
      ArrowUp: () => (y = clamp(y - step, 0, 1 - heightFrac)),
      ArrowDown: () => (y = clamp(y + step, 0, 1 - heightFrac))
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      move();
    }
  };

  const apply = () => onapply({ x, y, width: widthFrac, height: heightFrac });
</script>

<Dialog.Root open={imageId !== null} onOpenChange={(next) => { if (!next) oncancel(); }}>
  <Dialog.Content data-testid="crop-dialog" class="sm:max-w-lg">
    {#if imageId !== null}
      <Dialog.Header>
        <Dialog.Title>Frame {name ?? 'the picture'}</Dialog.Title>
        <Dialog.Description>
          Drag the square over the face. Arrow keys nudge it; hold shift to move further.
        </Dialog.Description>
      </Dialog.Header>

      <div
        bind:this={frame}
        class="relative mx-auto max-h-[50dvh] w-fit max-w-full overflow-hidden rounded-lg bg-gray-100 select-none dark:bg-white/5"
      >
        <img
          src="/api/image/{imageId}/uncropped"
          alt=""
          draggable="false"
          onload={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            natural = { width: img.naturalWidth, height: img.naturalHeight };
          }}
          class="block max-h-[50dvh] w-auto max-w-full"
        />

        <!-- The dim is one huge spread shadow, clipped by the frame's overflow-hidden. It
             is set inline rather than as a utility because Tailwind composes `shadow-*` and
             `ring-*` through the same box-shadow property, so the ring silently replaced it.
             The border is an outline for the same reason. -->
        <div
          role="slider"
          tabindex="0"
          aria-label="Crop area"
          data-testid="crop-area"
          aria-valuenow={Math.round(side * 100)}
          aria-valuemin={20}
          aria-valuemax={100}
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onkeydown={onKeyDown}
          class="absolute cursor-move rounded-full outline-2 outline-white focus-visible:outline-4 focus-visible:outline-indigo-400"
          style="left: {x * 100}%; top: {y * 100}%; width: {widthFrac * 100}%; height: {heightFrac * 100}%;
                 box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55)"
        ></div>
      </div>

      <label class="mt-1 block">
        <span class="text-xs font-medium text-gray-700 dark:text-gray-300">Size</span>
        <input
          type="range"
          data-testid="crop-size"
          min="0.2"
          max="1"
          step="0.01"
          bind:value={side}
          class="mt-1 w-full accent-indigo-600"
        />
      </label>

      <Dialog.Footer class="flex-row justify-end gap-2">
        <button
          type="button"
          data-testid="crop-cancel"
          onclick={oncancel}
          class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="crop-apply"
          onclick={apply}
          disabled={saving}
          class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Use this crop'}
        </button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
