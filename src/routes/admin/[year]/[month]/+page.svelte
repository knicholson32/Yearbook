<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { monthsFull, basicPlural, dateToDateStringFormMonthDayYear } from '$lib/helpers';
  import { ChevronLeft, ChevronRight, ArrowLeft, Lock } from 'lucide-svelte';
  import ExportButton from '$lib/components/admin/ExportButton.svelte';
  import PhotoDialog from '$lib/components/upload/PhotoDialog.svelte';
  import Avatar from '$lib/components/Avatar.svelte';

  interface Props {
    data: import('./$types').PageData;
  }

  let { data }: Props = $props();

  const title = $derived(`${monthsFull[data.month - 1]} ${data.year}`);

  /** Groups that actually filed something; a caption-only group is listed but not counted. */
  const contributing = $derived(data.groups.filter((group) => group.count > 0).length);

  /** Wrap across year boundaries, so paging never lands on month 0 or 13. */
  const step = (delta: number) => {
    const raw = data.month - 1 + delta;
    const year = data.year + Math.floor(raw / 12);
    const month = (((raw % 12) + 12) % 12) + 1;
    return `/admin/${year}/${month}`;
  };

  let openId = $state<string | null>(null);

  // `?photo=<id>` opens a photo directly, the same as on the group's month page -- which is
  // what lets a move carry you to the photo in its new month.
  //
  // `seen` is a plain variable on purpose. Comparing against `openId` here would make the
  // effect depend on it, so closing the dialog would re-run this while the URL still held
  // the parameter, and immediately reopen the photo that was just dismissed.
  let seen: string | null = null;
  $effect(() => {
    const requested = page.url.searchParams.get('photo');
    if (requested === seen) return;
    seen = requested;
    openId = requested;
  });

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

  /** Photos are grouped for display, so the open one has to be found across every group. */
  const open = $derived(
    data.groups.flatMap((group) => group.images).find((image) => image.id === openId) ?? null
  );

  /** New people added while editing a photo join that photo's group, not the admin's. */
  const openFamilyId = $derived(
    data.groups.find((group) => group.images.some((image) => image.id === openId))?.id ?? null
  );
</script>

<svelte:head><title>Admin &middot; {title}</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
  <a
    href="/admin?year={data.year}"
    class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
  >
    <ArrowLeft class="size-4" />
    All of {data.year}
  </a>

  <div class="mt-3 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400" data-testid="month-total">
        {data.total}
        {basicPlural('photo', data.total)} from {contributing}
        {basicPlural('group', contributing)}
        {#if data.hdrCount > 0}&middot; {data.hdrCount} HDR{/if}
      </p>
    </div>

    <div
      class="flex items-center gap-1 rounded-lg bg-white p-1 shadow-sm outline outline-gray-200 dark:bg-white/5 dark:outline-white/10"
    >
      <a
        href={step(-1)}
        aria-label="Previous month"
        data-testid="admin-prev-month"
        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronLeft class="size-4" />
      </a>
      <a
        href={step(1)}
        aria-label="Next month"
        data-testid="admin-next-month"
        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <ChevronRight class="size-4" />
      </a>
    </div>
  </div>

  {#if data.locked}
    <p
      class="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 outline outline-sky-600/20 dark:bg-sky-400/10 dark:text-sky-200 dark:outline-sky-400/20"
      data-testid="locked-notice"
    >
      <Lock class="size-3.5 shrink-0" />
      <span>
        {#if data.lockReason === 'published'}
          {data.year} is published, so its photos cannot be changed. Unpublish it to edit.
        {:else}
          {data.year}'s photos are locked. Unlock them to edit.
        {/if}
      </span>
      <a href="/admin?year={data.year}" class="font-semibold underline">
        {data.lockReason === 'published' ? 'Unpublish' : 'Unlock'}
      </a>
    </p>
  {/if}

  <!-- Whole-month export -->
  <div
    class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-4 shadow-xs outline outline-gray-900/10 sm:px-6 dark:bg-white/5 dark:outline-white/10"
  >
    <div>
      <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Export {title}</h2>
      <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
        Every group's photos for this month.
      </p>
    </div>
    <ExportButton
      scope={{ kind: 'month', year: data.year, month: data.month }}
      label="Export the month"
      count={data.total}
      variant="default"
      testid="export-month"
    />
  </div>

  <!-- Who is in the month -->
  {#if data.people.length > 0}
    <h2 class="mt-8 mb-2 text-base font-semibold text-gray-900 dark:text-white">People</h2>
    <p class="mb-2 text-sm text-gray-500 dark:text-gray-400">
      Photos each person appears in this month.
    </p>
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

  <!-- One block per family group -->
  {#if data.groups.length === 0}
    <p class="mt-10 text-center text-sm text-gray-400">No photos in {title}.</p>
  {/if}

  {#each data.groups as group (group.id)}
    <section class="mt-8" data-testid="admin-group" data-group={group.id}>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex items-center gap-3">
          <!-- The label is built from these people's first names, so the faces and the
               heading are saying the same thing. -->
          <div class="flex -space-x-2" data-testid="group-faces">
            {#each group.members.slice(0, 4) as member (member.id)}
              <Avatar
                imageId={member.imageId}
                name={member.name}
                version={member.version}
                size={28}
                class="ring-2 ring-white dark:ring-zinc-900"
              />
            {/each}
          </div>

          <div>
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">{group.label}</h2>
            <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {group.count}
              {basicPlural('photo', group.count)}
              {#if group.people.length > 0}
                &middot; {group.people.map((p) => `${p.name} (${p.count})`).join(', ')}
              {/if}
            </p>
          </div>
        </div>

        <ExportButton
          scope={{ kind: 'group', year: data.year, month: data.month, familyId: group.id }}
          label="Export this group"
          count={group.count}
          testid="export-group-{group.id}"
        />
      </div>

      {#if group.caption !== null}
        <!-- A group only ever sees its own caption; this is the one view that reads them
             together, so each is attributed rather than run in as plain text. -->
        <blockquote
          class="mt-3 rounded-lg border-gray-900/20 bg-white px-4 py-3 shadow-xs outline outline-gray-900/10 dark:border-white/25 dark:bg-white/5 dark:outline-white/10"
          data-testid="group-caption"
        >
          <p class="text-sm whitespace-pre-line text-gray-700 dark:text-gray-200">
            {group.caption.text}
          </p>
          <footer class="mt-1.5 text-xs text-gray-400">
            {#if group.caption.updatedBy !== null}
              {group.caption.updatedBy} &middot;
            {/if}
            {dateToDateStringFormMonthDayYear(group.caption.updatedAt / 1000)}
          </footer>
        </blockquote>
      {/if}

      {#if group.count === 0}
        <!-- Reachable: writing a caption creates the month, so a group can describe a month
             it has not filed anything into. -->
        <p class="mt-3 text-sm text-gray-400" data-testid="group-no-photos">
          No photos filed here by this group.
        </p>
      {/if}

      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {#each group.images as image (image.id)}
          <div class="group relative">
            <!-- Opens the dialog here rather than sending the admin to the upload page:
                 that page is group-scoped, so another family's photo is not even there. -->
            <button
              type="button"
              data-testid="admin-photo"
              data-photo={image.id}
              onclick={() => openPhoto(image.id)}
              class="block w-full overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            >
              <!-- Four across a 60rem column is ~15rem a tile, which a 2x screen wants at
                   about 480px; 768 is the candidate that covers it. -->
              <img
                src="/api/image/{image.id}/512"
                srcset="/api/image/{image.id}/512 512w, /api/image/{image.id}/768 768w, /api/image/{image.id}/1024 1024w"
                sizes="(min-width: 64rem) 15rem, (min-width: 40rem) 24vw, 45vw"
                alt={image.caption ?? 'Photo'}
                loading="lazy"
                class="aspect-square w-full object-cover transition duration-300 group-hover:brightness-90"
                style="background-color: {image.hex}"
              />
            </button>

            {#if image.isHDR}
              <span
                class="pointer-events-none absolute top-1 right-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white backdrop-blur-sm"
                title="Converted to SDR on export"
              >
                HDR
              </span>
            {/if}

            <div
              class="mt-1.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
              data-testid="photo-uploader"
              data-uploader={image.uploader.personId}
            >
              <Avatar
                imageId={image.uploader.imageId}
                gravatarHash={image.uploader.gravatarHash}
                name={image.uploader.name}
                version={image.uploader.version}
                size={20}
              />
              <span class="truncate">{image.uploader.name}</span>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<PhotoDialog
  image={open}
  year={data.year}
  month={data.month}
  people={data.pickerPeople}
  families={data.families}
  canManage={open?.canManage ?? false}
  locked={data.locked}
  basePath="/admin"
  familyId={openFamilyId}
  onclose={closePhoto}
/>
