<script lang="ts">

  import { enhance } from '$app/forms';

  import type { PageProps } from './$types';


  let { data, form }: PageProps = $props();


  let photoUpload: HTMLInputElement | null = $state(null);
  let profileImage: HTMLImageElement | null = $state(null);

  const updatedProfilePhoto = () => {
    if (photoUpload === null || photoUpload.files === null || profileImage === null) return;
    const file = photoUpload.files[0];
		
    if (file) {
      const reader = new FileReader();
      reader.addEventListener("load", function () {
        if (profileImage === null || reader.result === null) return;
        profileImage.setAttribute("src", reader.result as string);
      });
      reader.readAsDataURL(file);
			return;
    } 
  }

  // The chosen family id, or '' for "nothing picked yet". A native <select> can only ever
  // hold one option, so single-selection is the element's own guarantee rather than
  // something this page has to maintain -- which is why the custom combobox that used to
  // live here is gone.
  let value = $state("");


</script>




<!--
  This example requires updating your template:

  ```
  <html class="h-full bg-gray-50 dark:bg-gray-900">
  <body class="h-full">
  ```
-->
<form use:enhance enctype="multipart/form-data" action="?/create" method="POST" class="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
  <div class="sm:mx-auto sm:w-full sm:max-w-md">
    <button class="w-20 h-20 mx-auto relative bg-indigo-600 rounded-full flex justify-center items-center group cursor-pointer" onclick={() => photoUpload?.click()}>
      <img bind:this={profileImage} class="relative mx-auto h-20 w-auto rounded-full group-hover:opacity-0 transition-opacity z-10" src="https://www.gravatar.com/avatar/{data.hash}?s=300&d=identicon" alt="">
      <div class="absolute z-0 text-white">Upload</div>
    </button>
    <input bind:this={photoUpload} onchange={updatedProfilePhoto} type="file" id="image" name="image" accept="image/*" class="hidden">
    <h2 class="mt-6 text-center text-2xl/9 font-bold tracking-tight text-gray-900 dark:text-white">Create your Account</h2>
  </div>

  <div class="mt-10 sm:mx-auto sm:w-full sm:max-w-120">
    <div class="bg-white px-6 py-12 shadow-sm sm:rounded-lg sm:px-12 dark:bg-gray-800/50 dark:shadow-none dark:outline dark:-outline-offset-1 dark:outline-white/10">
      <div class="space-y-6">
        <div>
          <label for="email" class="block text-sm/6 font-medium text-gray-900 dark:text-white">Email address</label>
          <div class="mt-2">
            <input id="email" type="email" name="email" required autocomplete="email" value={data.email} disabled class="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500 cursor-not-allowed" />
          </div>
        </div>

        <div>
          <label for="name" class="block text-sm/6 font-medium text-gray-900 dark:text-white">Name</label>
          <div class="mt-2">
            <el-autocomplete class="relative mt-2 block">
              <input id="name" type="text" required name="name" class="block w-full rounded-md bg-white py-1.5 pr-12 pl-3 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500" />
              <button type="button" class="absolute inset-y-0 right-0 flex items-center rounded-r-md px-2" aria-label="Input Box">
                <svg viewBox="0 0 20 20" fill="currentColor" data-slot="icon" aria-hidden="true" class="size-5 text-gray-400">
                  <path d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" fill-rule="evenodd" />
                </svg>
              </button>

              <el-options anchor="bottom end" popover="auto" class="max-h-60 w-(--input-width) overflow-auto rounded-md bg-white py-1 text-base shadow-lg outline outline-black/5 transition-discrete [--anchor-gap:--spacing(1)] data-leave:transition data-leave:duration-100 data-leave:ease-in data-closed:data-leave:opacity-0 sm:text-sm dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10">
                {#each data.persons as person}
                  <el-option value={person.name} class="block truncate px-3 py-2 text-gray-900 select-none cursor-pointer aria-selected:bg-indigo-600 aria-selected:text-white dark:text-gray-300 dark:aria-selected:bg-indigo-500">{ person.name }</el-option>
                {/each}
              </el-options>
            </el-autocomplete>

          </div>
        </div>

        <div>
          <label for="group" class="block text-sm/6 font-medium text-gray-900 dark:text-white">Family Group</label>
          <div class="mt-2">
            <!--
              A native <select>: the option list is drawn by the browser (and by iOS as its own
              wheel), so it cannot be left half-open, cannot be clipped by an ancestor, and needs
              no focus juggling of its own. `required` plus the empty placeholder option means the
              browser refuses to submit until a real group is picked, ahead of the server check.

              The chevron is not drawn here: `@plugin '@tailwindcss/forms'` in `layout.css` already
              paints one as a background image on every `select`, so an svg of our own lands a
              second arrow beside it.
            -->
            <select
              id="group"
              name="group"
              required
              bind:value
              class="block w-full appearance-none rounded-md bg-white py-1.5 pr-10 pl-3 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:focus:outline-indigo-500 cursor-pointer"
            >
              <!--
                The popup list is painted by the OS, which does not composite a translucent
                `bg-white/5` over the page the way the closed control does, so the options get
                their own opaque colours or they come out unreadable in dark mode.
              -->
              <option value="" disabled>Select a Group...</option>
              {#each data.families as family}
                <option value={family.value} class="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">{family.label}</option>
              {/each}
            </select>

          </div>
        </div>


        <div class="mt-10">
          <button type="submit" class="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500 cursor-pointer">Create</button>
          {#if form?.error}
            <span class="text-red-500 text-xs">{form.error}</span>
          {/if}
        </div>
      </div>

    </div>
  </div>
</form>
