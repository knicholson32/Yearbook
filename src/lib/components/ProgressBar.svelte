<script lang="ts">
  /**
   * A thin progress bar for a single upload.
   *
   * Shows real progress while the bytes go out, then switches to an indeterminate sweep:
   * once the file has landed the server is still building derivatives, and there is no
   * progress signal for that -- better to say "working" than to sit at a frozen 100%.
   */
  interface Props {
    /** 0-100, or null when nothing is in flight. */
    percent: number | null;
    class?: string;
  }

  let { percent, class: className = '' }: Props = $props();

  const processing = $derived(percent !== null && percent >= 100);
</script>

{#if percent !== null}
  <div
    role="progressbar"
    aria-valuenow={processing ? undefined : percent}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={processing ? 'Processing' : 'Uploading'}
    class="h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10 {className}"
  >
    {#if processing}
      <div class="sweep h-full w-1/3 rounded-full bg-indigo-500"></div>
    {:else}
      <div
        class="h-full rounded-full bg-indigo-500 transition-[width] duration-150"
        style="width: {percent}%"
      ></div>
    {/if}
  </div>
{/if}

<style>
  .sweep {
    animation: sweep 1s ease-in-out infinite;
  }

  @keyframes sweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(300%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .sweep {
      animation: none;
      width: 100%;
    }
  }
</style>
