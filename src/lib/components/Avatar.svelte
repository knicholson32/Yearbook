<script lang="ts">
  /**
   * A person's picture.
   *
   * Profile pictures are ordinary stored images, so this just points at the usual endpoint.
   * The Gravatar fallback is only for people who predate the profile pipeline or were
   * added to a group without a picture.
   */
  interface Props {
    /** The person's stored profile image id, if they have one. */
    imageId?: string | null;
    /** Used only when there is no stored image. */
    gravatarHash?: string | null;
    name?: string | null;
    /**
     * Bumped whenever the underlying image is rebuilt (a crop, say). Without it the URL
     * is unchanged and the browser keeps showing the copy it already cached.
     */
    version?: string | number | null;
    /** Rendered pixel size; picks the smallest derivative that covers 2x. */
    size?: number;
    class?: string;
  }

  let {
    imageId = null,
    gravatarHash = null,
    name = null,
    version = null,
    size = 32,
    class: className = ''
  }: Props = $props();

  // 128 and 256 are stored as database blobs, so small avatars never touch the filesystem.
  const derivative = $derived(size * 2 <= 128 ? 128 : size * 2 <= 256 ? 256 : 512);

  const cacheBust = $derived(version === null ? '' : `?v=${encodeURIComponent(String(version))}`);

  const src = $derived(
    imageId !== null
      ? `/api/image/${imageId}/${derivative}${cacheBust}`
      : `https://www.gravatar.com/avatar/${gravatarHash ?? ''}?s=${size * 2}&d=identicon`
  );
</script>

<img
  {src}
  alt={name ?? ''}
  width={size}
  height={size}
  loading="lazy"
  class="shrink-0 rounded-full bg-gray-200 object-cover dark:bg-white/10 {className}"
  style="width: {size}px; height: {size}px"
/>
