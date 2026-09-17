<script lang="ts">
  /**
   * Somewhere to answer "is this actually rendering in HDR?" on a real device.
   *
   * Nothing here can be asserted from a test harness: whether Safari grants extended dynamic
   * range is a property of how the compositor drew the frame, not of the DOM, so the only
   * instrument is a person's eyes on an HDR display. What this page can do is remove the
   * guesswork about *which* condition is responsible -- the same photograph is drawn under one
   * named condition at a time, with an SDR copy beside it as a reference.
   *
   * Read it on the phone. Where a tile looks brighter than the SDR reference beside it, that
   * condition kept HDR. Where it matches, that condition lost it.
   */
  import PhotoViewer from '$lib/components/yearbook/PhotoViewer.svelte';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  const photo = $derived(data.hdr[0] ?? null);

  let which = $state(0);
  const pick = (i: number) => (which = i);

  /** The viewer binds this, so it has to be state rather than a derived expression. */
  let viewerIndex = $state<number | null>(null);

  /**
   * The conditions that are actually in question.
   *
   * An earlier round showed plain layer/filter/opacity tricks all keep HDR, so those are gone.
   * What is left is `backdrop-filter`: an element that samples its backdrop forces that
   * backdrop to be rasterised, and the suspicion is that Safari composites the resulting group
   * in SDR. Each pair below is the same photograph with and without one, so the answer is a
   * comparison rather than a memory of what the last tile looked like.
   */
  /**
   * Full-screen overlay variants, each differing from the next by one ingredient.
   *
   * The in-page test came back HDR for every condition, including a `backdrop-filter` sibling,
   * so whatever costs the photograph its HDR is a property of the *overlay* rather than of the
   * image's own CSS. These strip the viewer down and add its parts back one at a time.
   *
   * Tap each, look, dismiss. The first one that goes flat names the culprit.
   */
  const OVERLAYS = [
    {
      key: 'bare',
      label: '1. Bare fullscreen image',
      note: 'A fixed layer and the photograph. No background, no chrome, no clipping.',
      wrapper: 'fixed inset-0 z-50',
      ground: '',
      clip: false,
      backdropFilter: false
    },
    {
      key: 'ground',
      label: '2. + near-black ground',
      note: 'Adds the dimmed background the viewer sits on.',
      wrapper: 'fixed inset-0 z-50',
      ground: 'bg-black/95',
      clip: false,
      backdropFilter: false
    },
    {
      key: 'clip',
      label: '3. + overflow-hidden',
      note: 'Adds the clip on the fixed container, which can force rasterisation.',
      wrapper: 'fixed inset-0 z-50 overflow-hidden',
      ground: 'bg-black/95',
      clip: true,
      backdropFilter: false
    },
    {
      key: 'backdrop',
      label: '4. + full-screen backdrop-filter',
      note: 'The viewer as it was before today: a blurring layer covering the whole viewport.',
      wrapper: 'fixed inset-0 z-50 overflow-hidden',
      ground: 'bg-black/92',
      clip: true,
      backdropFilter: true
    }
  ];

  let variant = $state<(typeof OVERLAYS)[number] | null>(null);
</script>

<svelte:head><title>Admin &middot; HDR bench</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
  <a
    href="/admin"
    class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
  >
    &larr; Admin
  </a>

  <h1 class="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">HDR bench</h1>
  <p class="mt-1 max-w-prose text-sm text-gray-500 dark:text-gray-400">
    Open this on the iPhone. Tap each overlay, look at the photograph, then tap it to dismiss.
    They differ by one ingredient each, so the first one that looks flat names the cause.
    Compare against the two reference photos at the bottom.
  </p>

  {#if photo === null}
    <p class="mt-10 text-sm text-gray-400">No HDR photos in the library to test with.</p>
  {:else}
    <div class="mt-6 flex flex-wrap items-center gap-2">
      <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Photo:</span>
      {#each data.hdr as candidate, i (candidate.id)}
        <button
          type="button"
          onclick={() => pick(i)}
          class="rounded-md px-2 py-1 text-xs font-mono {which === i
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
            : 'text-gray-600 outline outline-gray-300 dark:text-gray-300 dark:outline-white/15'}"
        >
          {candidate.id.slice(0, 8)}
        </button>
      {/each}
    </div>

    {@const shown = data.hdr[which] ?? photo}

    <section class="mt-8 space-y-6">
      <div class="space-y-2">
        {#each OVERLAYS as option (option.key)}
          <button
            type="button"
            onclick={() => (variant = option)}
            class="block w-full rounded-lg bg-white px-4 py-3 text-left shadow-xs outline outline-gray-900/10 hover:outline-sky-500 dark:bg-white/5 dark:outline-white/10"
          >
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{option.label}</span>
            <span class="block text-xs text-gray-500 dark:text-gray-400">{option.note}</span>
          </button>
        {/each}

        <button
          type="button"
          onclick={() => (viewerIndex = which)}
          class="block w-full rounded-lg bg-gray-900 px-4 py-3 text-left text-white dark:bg-white dark:text-gray-900"
        >
          <span class="text-sm font-semibold">5. The real viewer (backdrop-filter removed)</span>
          <span class="block text-xs opacity-70">
            If this one is bright, the fix already landed and the rest is confirmation.
          </span>
        </button>
      </div>

      {#if data.sdr !== null}
        <figure class="pt-4">
          <img src="/api/image/{data.sdr.id}/2048" alt="SDR reference" class="w-full rounded-lg" />
          <figcaption class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span class="font-mono font-semibold text-gray-900 dark:text-white">SDR reference</span>
            &mdash; no gain map, so nothing can make it brighter. The ruler.
          </figcaption>
        </figure>
      {/if}

      <figure>
        <img src="/api/image/{shown.id}/2048" alt="HDR in the page" class="w-full rounded-lg" />
        <figcaption class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span class="font-mono font-semibold text-gray-900 dark:text-white">HDR in the page</span>
          &mdash; the known-good case. Compare each overlay against this.
        </figcaption>
      </figure>
    </section>

    <p class="mt-10 text-xs text-gray-400">
      Tell me which labels looked bright and which looked flat, and the fix follows from that.
    </p>
  {/if}
</div>

<PhotoViewer photos={data.hdr} bind:index={viewerIndex} onclose={() => (viewerIndex = null)} />

{#if variant !== null && photo !== null}
  <!-- Built by hand rather than by reusing the viewer, so each ingredient can be present or
       absent on its own. Tap anywhere to dismiss. -->
  <div class={variant.wrapper}>
    <button
      type="button"
      aria-label="Close"
      onclick={() => (variant = null)}
      class="absolute inset-0 cursor-default {variant.ground}"
    ></button>

    {#if variant.backdropFilter}
      <div class="pointer-events-none absolute inset-0 backdrop-blur-sm"></div>
    {/if}

    <img
      src="/api/image/{(data.hdr[which] ?? photo).id}/2048"
      alt=""
      class="pointer-events-none absolute inset-0 size-full object-contain"
    />

    <p class="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)_+_1rem)] text-center text-xs text-white/70">
      {variant.label} &mdash; tap to close
    </p>
  </div>
{/if}
