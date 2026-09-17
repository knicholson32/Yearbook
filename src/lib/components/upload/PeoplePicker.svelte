<script lang="ts">
  import { enhance } from '$app/forms';
  import { Check, Plus, Search, UserPlus } from 'lucide-svelte';

  interface Person { id: string; name: string }
  interface Family { id: string; label: string }

  interface Props {
    people: Person[];
    families: Family[];
    /** Ids of the people currently tagged. Bound, so the parent form can submit them. */
    selected: string[];
    /**
     * Group a newly added person should join. Only honoured for admins, who may be editing
     * another group's photo -- everyone else gets their own group regardless of what is
     * sent. Null means "the caller's own group".
     */
    familyId?: string | null;
    /**
     * Read-only: the tags are shown but cannot be changed.
     *
     * The server refuses the edit anyway, and the Save button is already disabled, but a
     * checkbox that visibly ticks and then silently does nothing is worse than one that
     * plainly will not.
     */
    disabled?: boolean;
  }

  let {
    people,
    families,
    selected = $bindable(),
    familyId = null,
    disabled = false
  }: Props = $props();

  let query = $state('');
  let adding = $state(false);
  let newName = $state('');
  let newFamily = $state('');
  let addError = $state<string | null>(null);

  // Default to the first family once the list is available.
  $effect(() => {
    if (newFamily === '' && families.length > 0) newFamily = families[0].id;
  });

  const matches = $derived(
    people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  const toggle = (id: string) => {
    if (disabled) return;
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  };
</script>

<div class="space-y-2">
  <div class="relative">
    <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-gray-400" />
    <input
      type="text"
      bind:value={query}
      data-testid="people-search"
      placeholder="Search people"
      class="block w-full rounded-md bg-white py-1.5 pr-3 pl-8 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 dark:bg-white/5 dark:text-white dark:outline-white/10"
    />
  </div>

  <div class="max-h-48 space-y-0.5 overflow-y-auto rounded-md bg-gray-50 p-1 dark:bg-white/5">
    {#each matches as person (person.id)}
      {@const on = selected.includes(person.id)}
      <button
        type="button"
        onclick={() => toggle(person.id)}
        {disabled}
        data-testid="person-option"
        data-person={person.id}
        aria-pressed={on}
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent hover:bg-gray-200 dark:hover:bg-white/10 {on
          ? 'font-medium text-indigo-700 dark:text-indigo-300'
          : 'text-gray-700 dark:text-gray-300'}"
      >
        <span class="flex size-4 shrink-0 items-center justify-center rounded border {on
          ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
          : 'border-gray-300 dark:border-white/20'}">
          {#if on}<Check class="size-3" />{/if}
        </span>
        {person.name}
      </button>
    {:else}
      <p class="px-2 py-3 text-center text-xs text-gray-400">
        {query.trim() === '' ? 'Nobody added yet' : `No match for "${query}"`}
      </p>
    {/each}
  </div>

  <!-- New people join the caller's own group. The server only honours the family below for
       an admin, who may be tagging another group's photo; for anyone else it is ignored.
       Person.name is unique across the whole database, so duplicates surface as an error. -->
  <!-- Adding a person is pointless while the tags cannot be changed. -->
  {#if !disabled}
    {#if adding}
      <form
        method="POST"
        action="?/createPerson"
        use:enhance={() => async ({ result, update }) => {
          if (result.type === 'success') {
            const id = (result.data as { personId?: string })?.personId;
            if (id !== undefined) selected = [...selected, id];
            newName = '';
            adding = false;
            addError = null;
            await update({ reset: false });
          } else if (result.type === 'failure') {
            addError = (result.data as { message?: string })?.message ?? 'Could not add person';
          }
        }}
        class="space-y-2 rounded-md bg-gray-50 p-2 dark:bg-white/5"
      >
        {#if familyId !== null}
          <input type="hidden" name="familyId" value={familyId} />
        {/if}
        <input
          name="name"
          bind:value={newName}
          placeholder="Full name"
          required
          class="block w-full rounded-md bg-white px-2 py-1.5 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 dark:bg-white/5 dark:text-white dark:outline-white/10"
        />
        {#if addError !== null}
          <p class="text-xs text-red-600 dark:text-red-400">{addError}</p>
        {/if}
        <div class="flex gap-2">
          <button type="submit" class="rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-500">
            Add
          </button>
          <button type="button" onclick={() => { adding = false; addError = null; }} class="rounded-md px-2 py-1 text-xs text-gray-500">
            Cancel
          </button>
        </div>
      </form>
    {:else}
      <button
        type="button"
        data-testid="picker-add-person"
        onclick={() => (adding = true)}
        class="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        <UserPlus class="size-3.5" /> Add someone new
      </button>
    {/if}
  {/if}
</div>
