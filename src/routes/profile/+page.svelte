<script lang="ts">

  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import { tick } from "svelte";
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";
  import Avatar from "$lib/components/Avatar.svelte";
  import { invalidateAll } from "$app/navigation";
  import { Trash2, UserPlus, ShieldCheck } from "lucide-svelte";
  import ProgressBar from "$lib/components/ProgressBar.svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import CropDialog, { type Rect } from "$lib/components/CropDialog.svelte";
  import { Crop } from "lucide-svelte";
  import { basicPlural } from "$lib/helpers";
  import { applyResult, submitWithProgress } from "$lib/upload";

  import type { PageProps } from './$types';

  let adminMessage = $state<string | null>(null);
  let adminError = $state(false);
  let adminTimer: ReturnType<typeof setTimeout> | undefined;
    import { enhance } from "$app/forms";
  let { data, form }: PageProps = $props();

  /** First names of everyone in the group, for the header line. */
  const groupLabel = $derived(
    data.group.length > 0
      ? data.group.map((p) => p.name.split(' ')[0]).join(', ')
      : 'No group yet'
  );

  /** The signed-in user's own record, taken from the group list. */
  const me = $derived(data.group.find((p) => p.isSelf) ?? null);

  // Upload progress per target, keyed by person id (or 'new' for the add-person form).
  // null means nothing in flight for that target.
  let progress = $state<Record<string, number | null>>({});
  let uploadError = $state<string | null>(null);

  /**
   * Send a photo form by hand so the bar can show real progress, then hand the result to
   * SvelteKit the way `use:enhance` would.
   *
   * @param key which row's bar to drive
   * @param form the form element to submit
   */
  const uploadPhoto = async (key: string, form: HTMLFormElement) => {
    if (progress[key] !== null && progress[key] !== undefined) return; // already going
    uploadError = null;
    progress[key] = 0;
    try {
      const action = form.getAttribute('action') ?? '';
      const result = await submitWithProgress(action, new FormData(form), (p) => (progress[key] = p));
      uploadError = await applyResult(result);

      // Offer to frame it immediately: a fresh upload is exactly when someone wants to
      // pick the face out, and `data` has just been refreshed with the new image id.
      if (uploadError === null && key !== 'new') {
        const person = data.group.find((p) => p.id === key);
        if (person) openCropper(person);
      }
    } finally {
      progress[key] = null;
      form.reset();
    }
  };

  /** The person whose picture is being framed, or null when the cropper is closed. */
  let cropping = $state<{ id: string; name: string; imageId: string; crop: Rect | null } | null>(null);
  let cropSaving = $state(false);

  const openCropper = (person: { id: string; name: string; imageId: string | null; crop: Rect | null }) => {
    if (person.imageId === null) return;
    cropping = { id: person.id, name: person.name, imageId: person.imageId, crop: person.crop };
  };

  /**
   * Send the framing to the server, which reapplies it to the untouched original.
   */
  const applyCrop = async (rect: Rect) => {
    if (cropping === null) return;
    cropSaving = true;
    uploadError = null;
    try {
      const body = new FormData();
      body.set('person', cropping.id);
      for (const [key, value] of Object.entries(rect)) body.set(key, String(value));
      const result = await submitWithProgress('?/cropPhoto', body, () => {});
      uploadError = await applyResult(result);
      if (uploadError === null) cropping = null;
    } finally {
      cropSaving = false;
    }
  };

  /** The person awaiting removal confirmation, or null. */
  let confirmRemove = $state<{ id: string; name: string; taggedIn: number } | null>(null);

  let newName = $state('');
  let newPersonPhoto = $state<HTMLInputElement | null>(null);
  let myPhotoInput = $state<HTMLInputElement | null>(null);
  // One file input per person, keyed by id, so each row submits its own form.
  let photoInputs = $state<Record<string, HTMLInputElement | null>>({});

  let open = $state(false);
  // Seeded in an effect rather than the initialiser: reading `data` directly captures only
  // its first value, leaving the picker stale after a save reloads the page data.
  let value = $state('');
  $effect.pre(() => {
    value = data.user?.person.familyId ?? '';
  });
  let triggerRef = $state<HTMLButtonElement>(null!);
 
  const selectedValue = $derived(
    data.families.find((f) => f.value === value)?.label
  );
 
  // We want to refocus the trigger button when the user selects
  // an item from the list so users can continue navigating the
  // rest of the form with the keyboard.
  function closeAndFocusTrigger() {
    open = false;
    tick().then(() => {
      triggerRef.focus();
    });
  }

</script>

<div class="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

  <!-- Page header -->
  <div class="flex items-center gap-4">
    <Avatar
      imageId={me?.imageId}
      gravatarHash={data.user?.gravatarHash}
      name={me?.name}
      version={me?.imageVersion}
      size={64}
      class="ring-2 ring-white shadow-sm dark:ring-white/10"
    />
    <div class="min-w-0">
      <h1 class="truncate text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
        {me?.name ?? 'Your profile'}
      </h1>
      <p class="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
        {data.user?.id}
      </p>
      <p class="mt-0.5 truncate text-xs text-gray-400">
        {groupLabel}
      </p>
    </div>
  </div>

  <h2 class="mt-8 mb-2 text-base font-semibold text-gray-900 dark:text-white">Your details</h2>

  <form use:enhance enctype="multipart/form-data" method="POST" action="?/updateProfile" class="w-full rounded-xl bg-white shadow-xs outline outline-gray-900/5 dark:bg-white/5 dark:outline-white/10">
    <input name="person" type="hidden" value={data.user?.personId} />
    <div class="px-4 py-6 sm:p-8">
      <div class="grid max-w-2xl grid-cols-1 gap-x-6 gap-y-8">
        <div class="">
          <label for="name" class="block text-sm/6 font-medium text-gray-900 dark:text-white">Name</label>
          <div class="mt-2">
            <input id="name" type="text" name="name" required autocomplete="name" value={data.user?.person.name} class="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500" />
          </div>
        </div>

        <div class="">
          <label for="family-group" class="block text-sm/6 font-medium text-gray-900 dark:text-white">Family Group</label>
          <div class="mt-2">
            <input id="group" name="group" hidden value={value}/>
            <Popover.Root bind:open>
              <Popover.Trigger bind:ref={triggerRef} class="w-full">
                {#snippet child({ props })}
                  <Button
                    variant="outline"
                    class="justify-between"
                    {...props}
                    role="combobox"
                    aria-expanded={open}
                  >
                    {selectedValue || "Select a Group..."}
                    <div class="grow"></div>
                    <ChevronsUpDownIcon class="ms-2 size-4 shrink-0 opacity-50" />
                  </Button>
                {/snippet}
              </Popover.Trigger>
              <Popover.Content class="w-full p-0">
                <Command.Root>
                  <Command.Input placeholder="Search groups..." />
                  <Command.List>
                    <Command.Empty>No groups found.</Command.Empty>
                    <Command.Group>
                      {#each data.families as family}
                        <Command.Item
                          value={family.value}
                          onSelect={() => {
                            value = family.value;
                            closeAndFocusTrigger();
                          }}
                        >
                          <!--
                            Exactly one group is ever chosen, so exactly one tick may show. Hide the
                            others with opacity rather than `text-transparent`: `Command.Item` paints
                            every descendant svg via `data-selected:**:[svg]:text-foreground` while a
                            row is merely highlighted, and that selector outranks a colour class on
                            the icon -- so the hovered row grew a tick of its own and the list looked
                            multi-select even though only one value was ever held.
                          -->
                          <CheckIcon
                            class={cn(
                              "me-2 size-4",
                              value === family.value ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {family.label}
                        </Command.Item>
                      {/each}
                    </Command.Group>
                  </Command.List>
                </Command.Root>
              </Popover.Content>
            </Popover.Root>

          </div>
        </div>

        <div class="col-span-full">
          <span class="block text-sm/6 font-medium text-gray-900 dark:text-white">Photo</span>
          <div class="mt-2 flex items-center gap-x-3">
            <Avatar
              imageId={me?.imageId}
              gravatarHash={data.user?.gravatarHash}
              name={me?.name}
              version={me?.imageVersion}
              size={48}
            />
            <!-- Its own form: the picture uploads on pick, separately from Save. -->
            <button
              type="button"
              disabled={me !== null && progress[me.id] != null}
              data-testid="self-photo-button"
              onclick={() => myPhotoInput?.click()}
              class="cursor-pointer rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:bg-white/10 dark:text-white dark:inset-ring-white/15 dark:hover:bg-white/15"
            >
              {me !== null && progress[me.id] != null ? 'Uploading…' : 'Change'}
            </button>
            {#if me?.imageId}
              <button
                type="button"
                data-testid="self-reframe"
              onclick={() => me && openCropper(me)}
                class="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
              >
                <Crop class="size-4" /> Reframe
              </button>
            {/if}
          </div>
          <ProgressBar percent={(me && progress[me.id]) ?? null} class="mt-2 max-w-48" />
        </div>

      </div>
    </div>
    <div class="flex items-center justify-end gap-x-6 border-t border-gray-900/10 px-4 py-4 sm:px-8">
      {#if form?.message}
        <span class="text-red-500 text-xs">{form.message}</span>
      {/if}
      <button type="submit" class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 cursor-pointer">Save</button>
    </div>
  </form>

  <!-- Sits outside the details form: HTML forbids nesting, and the picture saves on pick. -->
  <form method="POST" action="?/setPhoto" enctype="multipart/form-data">
    <input type="hidden" name="person" value={me?.id ?? ''} />
    <input
      type="file"
      name="image"
      accept="image/*,.heic,.heif"
      class="hidden"
      bind:this={myPhotoInput}
      onchange={(e) => { const f = e.currentTarget.form; if (f && me) uploadPhoto(me.id, f); }}
    />
  </form>
</div>

<!-- Group members -->
<div class="mx-auto max-w-4xl px-4 pb-12 sm:px-6 lg:px-8">
  <!-- Heading sits above the card, matching "Your details" -->
  <h2 class="mt-8 mb-2 text-base font-semibold text-gray-900 dark:text-white">Display</h2>
  <div class="rounded-xl bg-white shadow-xs outline outline-gray-900/10 dark:bg-white/5 dark:outline-white/10">
    {#if data.isAdmin}
      <!-- Admins only: this names the household rather than adjusting a view. -->
      <form
        method="POST"
        action="?/setFamilyName"
        use:enhance={() => async ({ update }) => await update({ reset: false })}
        class="flex flex-wrap items-end gap-4 border-b border-gray-900/10 px-4 py-4 sm:px-8 dark:border-white/10"
      >
        <div class="grow">
          <label for="family-name" class="block text-sm font-medium text-gray-900 dark:text-white">
            Collection name
          </label>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            What to call this yearbook collection as a whole. Only admins can change it.
          </p>
        </div>

        <input
          id="family-name"
          data-testid="family-name"
          name="familyName"
          type="text"
          maxlength="80"
          value={data.familyName}
          placeholder="The Nicholsons"
          class="w-56 rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline outline-gray-300 focus:outline-2 focus:outline-sky-500 dark:bg-white/5 dark:text-white dark:outline-white/10"
        />

        <Button type="submit" data-testid="save-family-name">Save</Button>
      </form>

      <!-- Admins only: the target every group is working towards. -->
      <form
        method="POST"
        action="?/setPhotosPerMonth"
        use:enhance={() => async ({ update }) => await update({ reset: false })}
        class="flex flex-wrap items-end gap-4 border-b border-gray-900/10 px-4 py-4 sm:px-8 dark:border-white/10"
      >
        <div class="grow">
          <label for="photos-per-month" class="block text-sm font-medium text-gray-900 dark:text-white">
            Photos per month
          </label>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            How many photos each group should add to every month. A month turns green once a
            group has that many.
          </p>
        </div>

        <input
          id="photos-per-month"
          data-testid="photos-per-month"
          name="photosPerMonth"
          type="number"
          min="1"
          max={data.photosPerMonthMax}
          step="1"
          value={data.photosPerMonth}
          class="w-20 rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline outline-gray-300 focus:outline-2 focus:outline-sky-500 dark:bg-white/5 dark:text-white dark:outline-white/10"
        />

        <Button type="submit" data-testid="save-photos-per-month">Save</Button>
      </form>
    {/if}
    <form
      method="POST"
      action="?/setMonthColumns"
      use:enhance={() => async ({ update }) => await update({ reset: false })}
      class="flex flex-wrap items-end gap-4 px-4 py-4 sm:px-8"
    >
      <div class="grow">
        <label
          for="month-columns"
          class="block text-sm font-medium text-gray-900 dark:text-white">Photos per row</label
        >
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          How many photos sit side by side on a month page. Narrow screens show fewer. This
          applies to everyone.
        </p>
      </div>

      <input
        id="month-columns"
        data-testid="month-columns"
        name="columns"
        type="number"
        min="1"
        max={data.monthColumnsMax}
        step="1"
        value={data.monthColumns}
        class="w-20 rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline outline-gray-300 focus:outline-2 focus:outline-sky-500 dark:bg-white/5 dark:text-white dark:outline-white/10"
      />

      <Button type="submit" data-testid="save-month-columns">Save</Button>
    </form>

    <form
      method="POST"
      action="?/setYearsBackground"
      use:enhance={() => async ({ update }) => await update({ reset: false })}
      class="flex flex-wrap items-end gap-4 border-t border-gray-900/10 px-4 py-4 sm:px-8 dark:border-white/10"
    >
      <div class="grow">
        <span class="block text-sm font-medium text-gray-900 dark:text-white">
          Yearbooks background
        </span>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          What sits behind the shelf on the Years page. Colours come from the published years'
          own photos.
        </p>
      </div>

      <div class="flex flex-wrap gap-2" data-testid="years-background">
        {#each data.yearsBackgrounds as option (option)}
          <button
            type="submit"
            name="background"
            value={option}
            data-background={option}
            class="rounded-lg px-3 py-1.5 text-sm font-medium capitalize {data.yearsBackground ===
            option
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'text-gray-700 outline outline-gray-300 hover:bg-gray-100 dark:text-gray-200 dark:outline-white/15 dark:hover:bg-white/10'}"
          >
            {option}
          </button>
        {/each}
      </div>
    </form>
  </div>

  <h2 class="mt-8 mb-2 text-base font-semibold text-gray-900 dark:text-white">Your group</h2>
  <div class="rounded-xl bg-white shadow-xs outline outline-gray-900/10 dark:bg-white/5 dark:outline-white/10">
    <div class="border-b border-gray-900/10 px-4 py-4 sm:px-8 dark:border-white/10">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        People who can be tagged in photos. Anyone without an account is managed here --
        children, or relatives who don't sign in.
      </p>
    </div>

    <ul class="divide-y divide-gray-900/10 dark:divide-white/10">
      {#each data.group as person (person.id)}
        <li data-testid="person-row" data-person={person.id} class="flex items-center gap-3 px-4 py-3 sm:px-8">
          <Avatar imageId={person.imageId} name={person.name} version={person.imageVersion} size={40} />

          <div class="grow">
            <div class="text-sm font-medium text-gray-900 dark:text-white">
              {person.name}
              {#if person.isSelf}<span class="ml-1 text-xs font-normal text-gray-400">(you)</span>{/if}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              {person.accountEmail ?? 'No account'}
            </div>
            <ProgressBar percent={progress[person.id] ?? null} class="mt-1.5 max-w-48" />
          </div>

          <form method="POST" action="?/setPhoto" enctype="multipart/form-data">
            <input type="hidden" name="person" value={person.id} />
            <input
              type="file"
              name="image"
              accept="image/*,.heic,.heif"
              class="hidden"
              onchange={(e) => { const f = e.currentTarget.form; if (f) uploadPhoto(person.id, f); }}
              bind:this={photoInputs[person.id]}
            />
            <button
              type="button"
              disabled={person.imageId === null}
              data-testid="person-reframe"
              onclick={() => openCropper(person)}
              title="Reframe {person.name}'s picture"
              aria-label="Reframe {person.name}'s picture"
              class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:invisible dark:text-gray-400 dark:hover:bg-white/10"
            >
              <Crop class="size-4" />
            </button>
          </form>
          <form method="POST" action="?/setPhoto" enctype="multipart/form-data">
            <input type="hidden" name="person" value={person.id} />
            <button
              type="button"
              disabled={progress[person.id] != null}
              data-testid="person-photo-button"
              onclick={() => photoInputs[person.id]?.click()}
              class="rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/10"
            >
              {progress[person.id] != null
                ? 'Uploading…'
                : person.imageId === null
                  ? 'Add photo'
                  : 'Change photo'}
            </button>
          </form>

          {#if person.accountEmail === null}
            <button
              type="button"
              data-testid="person-remove"
              onclick={() => (confirmRemove = { id: person.id, name: person.name, taggedIn: person.taggedIn })}
              title="Remove {person.name} from the group"
              aria-label="Remove {person.name}"
              class="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <Trash2 class="size-4" />
            </button>
          {:else}
            <!-- People with accounts own their own record, so removal is theirs to do. -->
            <span class="w-7"></span>
          {/if}
        </li>
      {/each}
    </ul>

    <form
      method="POST"
      action="?/addPerson"
      enctype="multipart/form-data"
      onsubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        uploadPhoto('new', form).then(() => { if (uploadError === null) newName = ''; });
      }}
      class="flex flex-wrap items-center gap-2 border-t border-gray-900/10 px-4 py-4 sm:px-8 dark:border-white/10"
    >
      <UserPlus class="size-4 shrink-0 text-gray-400" />
      <input
        name="name"
        data-testid="add-person-name"
        bind:value={newName}
        placeholder="Add someone without an account"
        required
        class="grow rounded-md bg-white px-3 py-1.5 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 dark:bg-white/5 dark:text-white dark:outline-white/10"
      />
      <input type="file" name="image" accept="image/*,.heic,.heif" class="hidden" bind:this={newPersonPhoto} />
      <button
        type="button"
        onclick={() => newPersonPhoto?.click()}
        class="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
      >
        Photo (optional)
      </button>
      <button
        type="submit"
        data-testid="add-person-submit"
        disabled={progress['new'] != null}
        class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {progress['new'] != null ? 'Adding…' : 'Add'}
      </button>
      <ProgressBar percent={progress['new'] ?? null} class="mt-1 w-full" />
    </form>
  </div>

  {#if uploadError ?? form?.message}
    <p class="mt-2 text-xs text-red-600 dark:text-red-400">{uploadError ?? form?.message}</p>
  {/if}
</div>

<!-- Removal is irreversible and detaches them from photos, so it asks first. Lives outside
     the list: the dialog portals to the body, and a form here cannot nest inside another. -->
<Dialog.Root
  open={confirmRemove !== null}
  onOpenChange={(next) => { if (!next) confirmRemove = null; }}
>
  <Dialog.Content data-testid="confirm-remove-dialog" class="sm:max-w-md">
    {#if confirmRemove !== null}
      <Dialog.Header>
        <Dialog.Title>Remove {confirmRemove.name}?</Dialog.Title>
        <Dialog.Description>
          {#if confirmRemove.taggedIn > 0}
            They're tagged in {confirmRemove.taggedIn}
            {basicPlural('photo', confirmRemove.taggedIn)}, and will be removed from
            {confirmRemove.taggedIn === 1 ? 'it' : 'them'}. The photos themselves are kept.
          {:else}
            They aren't tagged in any photos yet.
          {/if}
          Their profile picture is deleted. This can't be undone.
        </Dialog.Description>
      </Dialog.Header>

      <Dialog.Footer class="flex-row justify-end gap-2">
        <button
          type="button"
          onclick={() => (confirmRemove = null)}
          class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
        >
          Cancel
        </button>
        <form
          method="POST"
          action="?/removePerson"
          use:enhance={() => async ({ update }) => {
            confirmRemove = null;
            await update({ reset: false });
          }}
        >
          <input type="hidden" name="person" value={confirmRemove.id} />
          <button
            type="submit"
            data-testid="confirm-remove-yes"
            class="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
          >
            <Trash2 class="size-4" /> Remove
          </button>
        </form>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>

{#if data.isAdmin}
  <!-- Admins only, and deliberately here rather than on the dashboard: this is about who
       people are, like the rest of this page, not about a particular year's photos. -->
  <div class="mx-auto max-w-4xl px-4 pb-12 sm:px-6 lg:px-8">
    <h2 class="mt-8 mb-2 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
      <ShieldCheck class="size-4" />
      Administrators
    </h2>
    <div
      class="rounded-xl bg-white shadow-xs outline outline-gray-900/10 dark:bg-white/5 dark:outline-white/10"
      data-testid="admins-panel"
    >
      <p class="border-b border-gray-900/10 px-4 py-4 text-sm text-gray-500 sm:px-8 dark:border-white/10 dark:text-gray-400">
        Administrators see every group's photos, file pending uploads, export a year and
        publish it. Everyone else sees only their own group.
      </p>

      <ul class="divide-y divide-gray-900/10 dark:divide-white/10">
        {#each data.accounts as account (account.email)}
          <li class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-8">
            <Avatar
              imageId={account.imageId}
              gravatarHash={account.gravatarHash}
              version={account.version}
              name={account.name}
              size={32}
              class="shrink-0"
            />
            <div class="min-w-0 grow">
              <p class="truncate text-sm text-gray-900 dark:text-white">
                {account.name}
                {#if account.isSelf}
                  <span class="text-gray-400 dark:text-gray-500">(you)</span>
                {/if}
              </p>
              <p class="truncate text-xs text-gray-500 dark:text-gray-400">{account.email}</p>
            </div>

            {#if account.isAdmin}
              <span
                class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400"
              >
                Administrator
              </span>
            {/if}

            <form
              method="POST"
              action="?/setAdmin"
              use:enhance={() => async ({ result }) => {
                clearTimeout(adminTimer);
                adminError = result.type === 'failure';
                // Only these two carry a payload; a redirect or an error has no `data`.
                const payload =
                  result.type === 'failure' || result.type === 'success'
                    ? (result.data as { message?: string } | undefined)
                    : undefined;
                adminMessage = payload?.message ?? (adminError ? 'Could not change that' : null);
                adminTimer = setTimeout(() => (adminMessage = null), 3000);
                // `invalidateAll` rather than `update()`: this page renders `form.message` in
                // two other cards, and `form` is shared by every action on the route, so
                // letting this one populate it prints our result -- in red -- under someone
                // else's Save button. Reloading the data refreshes the list without that.
                await invalidateAll();
              }}
            >
              <input type="hidden" name="email" value={account.email} />
              <input type="hidden" name="admin" value={account.isAdmin ? 'false' : 'true'} />
              <Button type="submit" variant="outline" data-testid="toggle-admin">
                {account.isAdmin ? 'Remove' : 'Make administrator'}
              </Button>
            </form>
          </li>
        {/each}
      </ul>

      {#if adminMessage !== null}
        <p
          class="border-t border-gray-900/10 px-4 py-3 text-sm sm:px-8 dark:border-white/10 {adminError
            ? 'text-red-600 dark:text-red-400'
            : 'text-emerald-700 dark:text-emerald-400'}"
          data-testid="admins-message"
        >
          {adminMessage}
        </p>
      {/if}
    </div>
  </div>
{/if}

<CropDialog
  imageId={cropping?.imageId ?? null}
  name={cropping?.name}
  initial={cropping?.crop ?? null}
  saving={cropSaving}
  onapply={applyCrop}
  oncancel={() => (cropping = null)}
/>
