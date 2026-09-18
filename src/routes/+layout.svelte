<script lang="ts">
  import { page } from "$app/state";
  import { cubicIn, cubicInOut, cubicOut } from "svelte/easing";
  import "../app.css";
  // import "./layout.css";
  import { onMount, setContext } from 'svelte';
  import { EscapeOrClickOutside } from "$lib/components/events";
  import { fade, scale, slide } from "svelte/transition";
  import { icons } from "$lib/components";
  import * as Popover from "$lib/components/ui/popover";
  import { ModeWatcher } from "mode-watcher";
  import { Briefcase, ChevronRight, GitCommitVertical, Link, Plane, Send, Tag, X} from "lucide-svelte";
  // import ProgressBar from "$lib/components/decorations/ProgressBar.svelte";
  import { afterNavigate, beforeNavigate } from "$app/navigation";
  import NProgress from 'nprogress';
  import escapeOrClickOutside from "$lib/components/events/escapeOrClickOutside";
  import { timeConverter } from "$lib/helpers";
  import { browser } from "$app/environment";
  import Avatar from "$lib/components/Avatar.svelte";

  interface Props {
    data: import('./$types').PageData;
    children?: import('svelte').Snippet;
  }

  let { data, children }: Props = $props();

  // -----------------------------------------------------------------------------------------------
	// Navigation Menus
	// -----------------------------------------------------------------------------------------------

  type Submenu = {
    title: string,
    href: string, 
    icon: string,
    description: string,
  };

  type Menu = {
    title: string,
    href: string,
    submenu?: Submenu[],
    popover: false
  }[];

  // Menu contents. Derived rather than static state, because the admin entry only exists
  // for admins -- the pages themselves answer 404 to everyone else, so a visible link would
  // just be a dead end.
  const menu: Menu = $derived([
    { title: 'Years', popover: false,  href: '/' },
    { title: 'Upload', popover: false,  href: '/upload' },
    ...(data.user?.role === 'admin'
      ? [{ title: 'Admin', popover: false, href: '/admin' } as Menu[number]]
      : []),
    // { title: 'Entry', popover: false, href: `/entry`, submenu: [ { title: 'Tours', href: '/entry/tour', icon: 'briefcase', description: 'Enter flights that are associated with a work tour or duty day.'}, { title: 'Legs', href: '/entry/leg', icon: 'send', description: 'Enter generic flights that are not associated with a tour.'}] },
    // { title: 'Aircraft', popover: false, href: '/aircraft', submenu: [ { title: 'Aircraft', href: '/aircraft/entry', icon: 'plane', description: 'Document specific aircraft flown in flight legs.'}, { title: 'Types', href: '/aircraft/type', icon: 'tag', description: 'Create and manage common aircraft types.'}] },
    // { title: 'Logbook', popover: false, href: '/logbook' },
    // { title: 'Airports', popover: false, href: '/airports' },
  ]);

  // const p: typeof Popover.Root;

  // const attachPopoverRoot = (element: typeof Popover.Root) => {

  // }

  // Mobile menu controls
  let mobileNavMenuVisible = $state(false);
  let menuHeaderBar: HTMLElement | null = $state(null);
	const closeMobileMenu = () => mobileNavMenuVisible = false;
  const toggleMobileMenu = () => mobileNavMenuVisible = !mobileNavMenuVisible;

	// -----------------------------------------------------------------------------------------------
	// Profile Menus
	// -----------------------------------------------------------------------------------------------

  // The commit shown in the About dialog comes from `data.build`, stamped into the image at
  // build time -- no call to the GitHub API, which would fail on a private network anyway.
  let aboutOverlay = $state(false);
  const openAboutOverlay = () => {
    aboutOverlay = true;
  }
  const hideAboutOverlay = () => {
    aboutOverlay = false;
  }

  // Menu contents
  const profileMenu = [
    { title: 'Profile', href: '/profile' },
    { title: 'About', button: openAboutOverlay },
  ];

	// Primary profile menu
  let profileBar: HTMLElement | null = $state(null);
	let profileMenuVisible = $state(false);
	const toggleAccountDropdown = () => profileMenuVisible = !profileMenuVisible;
	const closeAccountDropdown = () => profileMenuVisible = false;

  // let progress: ProgressBar;
  let width = 0;

  NProgress.settings.showSpinner = false;


  beforeNavigate((navigate) => {
    if (navigate.type !== 'leave') {
      // NProgress.trickle();
      NProgress.start();
      // if (NProgress.isStarted())
    }
    // if (progress !== undefined && (navigate.type !== 'leave' && navigate.type !== 'popstate')) {
    //   progress.start();
    //   // width = 0.75;
    //   // navigate.complete.finally(() => {
    //   //   if (progress !== undefined) progress.complete();
    //   // });
    // }
    navigate.complete.finally(() => {
      NProgress.done();
    });
  });

  afterNavigate((navigate) => {

    closeAccountDropdown();
    closeMobileMenu();

  //   /**
  //    * New page load:
  //    *  from: null
  //    *  to: {params: {…}, route: {…}, url: URL}
  //    *  type: "enter"
  //    *  willUnload: false
  //    * 
  //    * In-App Navigation:
  //    *  from: {params: {…}, route: {…}, url: URL}
  //    *  to: {params: {…}, route: {…}, url: URL}
  //    *  type: "link"
  //    *  willUnload: false
  //    * 
  //    * Back / Forward Button:
  //    *  from: {params: {…}, route: {…}, url: URL}
  //    *  to: {params: {…}, route: {…}, url: URL}
  //    *  delta: -1
  //    *  type: "popstate"
  //    *  willUnload: false
  //    */
    if (NProgress.isStarted()) NProgress.done();
  });

</script>

<svelte:head>
  {#if page.data.seo === undefined}
    <title>Yearbook</title>
    <meta name="description" content="Yearbook" />
  {:else}
    <title>Yearbook | {page.data.seo.title}</title>
    <meta name="description" content={page.data.seo?.description} />
  {/if}
</svelte:head>

<ModeWatcher />

{#if page.url.pathname.includes('/user')}
  {@render children?.()}
{:else}

  <!--
    This example requires updating your template:

    ```
    <html class="h-full">
    <body class="h-full">
    ```
  -->

  <!-- `h-16` is gone from the nav itself: its height is now the safe-area inset plus the
       4rem bar inside it, so on a notched phone the bar sits below the clock rather than
       under it. The side insets keep the logo and the avatar clear of the rounded corners
       in landscape. -->
  <nav
    bind:this={menuHeaderBar}
    class="print:hidden relative z-50 border-b border-gray-200 bg-white pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] dark:border-zinc-800 dark:bg-zinc-900"
  >
    <div class="mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex h-16 justify-between select-none">
        <div class="flex">
          <div class="flex shrink-0 items-center">
            <a href="/">
              <span class="font-merienda font-bold text-xl">Yearbook</span>
            </a>
          </div>

          <div class="sm:ml-6"></div>
          <div class="hidden sm:-my-px sm:flex sm:space-x-8">
            <!-- Desktop Menu -->
            {#each menu as m, i}
              {#if m.submenu !== undefined}
                <Popover.Root bind:open={m.popover} >
                    {#if (page.url.pathname === '/' && m.href === '/') || (m.href !== '/' && page.url.pathname.startsWith('/' + m.href.split('/')[1]))}
                      <Popover.Trigger class="border-sky-500 relative z-40 text-gray-900 dark:text-white inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium">{m.title}</Popover.Trigger>
                    {:else}
                      <Popover.Trigger class="border-transparent relative z-40 text-gray-500 dark:text-gray-400 hover:border-gray-300 hover:text-gray-700 dark:hover:text-gray-200 inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium">{m.title}</Popover.Trigger>
                    {/if}
                    <Popover.Content collisionPadding={20} class="grid grid-cols-1 gap-x-4 gap-y-1 p-0 w-auto text-sm rounded-lg dark:bg-zinc-800 dark:border dark:border-zinc-900">
                      {#each m.submenu as item}
                        <div class="group relative flex gap-x-6 first:rounded-b-none rounded-lg last:rounded-t-none p-2 hover:bg-gray-100 dark:hover:bg-zinc-900 dark:bg-zinc-800">
                          <div class="mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-gray-50 group-hover:bg-white dark:bg-zinc-900 dark:group-hover:bg-zinc-950">
                            {#if item.icon === 'briefcase'}
                              <Briefcase class="h-6 w-6 text-gray-600 group-hover:text-sky-600 dark:text-gray-400" />
                            {:else if item.icon === 'send'}
                              <Send class="h-6 w-6 text-gray-600 group-hover:text-sky-600 dark:text-gray-400" />
                            {:else if item.icon === 'plane'}
                              <Plane class="h-6 w-6 text-gray-600 group-hover:text-sky-600 dark:text-gray-400" />
                            {:else if item.icon === 'tag'}
                              <Tag class="h-6 w-6 text-gray-600 group-hover:text-sky-600 dark:text-gray-400" />
                            {:else}
                              <Link class="h-6 w-6 text-gray-600 group-hover:text-sky-600 dark:text-gray-400" />
                            {/if}
                          </div>
                          <div class="mt-1">
                            <a href="{item.href}" onclick={() => m.popover = false} class="font-semibold text-gray-900 dark:text-gray-100">
                              {item.title}
                              <span class="absolute inset-0"></span>
                            </a>
                            <p class="mt-0 text-gray-600 dark:text-gray-400 pr-2">{item.description}</p>
                          </div>
                        </div>
                      {/each}
                    </Popover.Content>
                  </Popover.Root>
              {:else}
                <!-- Current: "border-sky-500 text-gray-900", Default: "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700" -->
                {#if (page.url.pathname === '/' && m.href === '/') || (m.href !== '/' && page.url.pathname.startsWith('/' + m.href.split('/')[1]))}
                  <a href="{m.href}" class="border-sky-500 relative z-40 text-gray-900 dark:text-white inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium" aria-current="page">{m.title}</a>  
                {:else}
                  <a href="{m.href}" class="border-transparent relative z-40 text-gray-500 dark:text-gray-400 hover:border-gray-300 hover:text-gray-700 dark:hover:text-gray-200 inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium">{m.title}</a>  
                {/if}
              {/if}
            {/each}
          </div>
        </div>
        <div class="hidden sm:ml-6 sm:flex sm:items-center">
          <!-- <button type="button" class="relative rounded-full p-1 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-2">
            <span class="absolute -inset-1.5"></span>
            <span class="sr-only">View notifications</span>
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </button> -->

          <!-- Profile dropdown -->
          <div bind:this={profileBar} use:EscapeOrClickOutside={{ callback: closeAccountDropdown, except: profileBar ?? undefined }} class="relative ml-3">
            <div>
              <button type="button" onclick={toggleAccountDropdown} class="touch-manipulation relative flex max-w-xs items-center rounded-full bg-white text-sm focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-2" id="user-menu-button" aria-expanded="false" aria-haspopup="true">
                <span class="absolute -inset-1.5"></span>
                <span class="sr-only">Open user menu</span>
                <Avatar imageId={data.user?.person.imageId} gravatarHash={data.user?.gravatarHash} name={data.user?.person.name} version={data.user?.person.profileImage?.updatedAt} size={32} />
              </button>
            </div>

            <!--
              Dropdown menu, show/hide based on menu state.

              Entering: "transition ease-out duration-200"
                From: "transform opacity-0 scale-95"
                To: "transform opacity-100 scale-100"
              Leaving: "transition ease-in duration-75"
                From: "transform opacity-100 scale-100"
                To: "transform opacity-0 scale-95"
            -->
            {#if profileMenuVisible}
              <div in:fade={{ duration: 200, easing: cubicOut }} out:fade={{ duration: 75, easing: cubicIn }}>
                <div in:scale={{ duration: 200, easing: cubicOut}} out:scale={{ duration: 75, easing: cubicIn }}>
                  <div class="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white dark:bg-zinc-900 py-1 shadow-lg ring-1 ring-black/5 dark:ring-zinc-800 focus:outline-hidden" role="menu" aria-orientation="vertical" aria-labelledby="user-menu-button" tabindex="-1">
                    <!-- Active: "bg-gray-100", Not Active: "" -->
                    {#each profileMenu as m}
                      {#if m.button !== undefined}
                        <button onclick={() => { closeAccountDropdown(); m.button() }} class="w-full text-left hover:bg-gray-50 dark:hover:bg-zinc-800 block px-4 py-2 text-sm text-gray-700 dark:text-gray-100 dark:hover:text-white" role="menuitem" tabindex="-1" id="user-menu-item-1">{m.title}</button>
                      {:else}
                        {#if page.url.pathname.startsWith(m.href)}
                          <a href="{m.href}" onclick={closeAccountDropdown} class="bg-gray-100 dark:bg-zinc-800 block px-4 py-2 text-sm text-gray-700 dark:text-gray-200" role="menuitem" tabindex="-1" id="user-menu-item-1">{m.title}</a>
                        {:else}
                          <a href="{m.href}" onclick={closeAccountDropdown} class="hover:bg-gray-50 dark:hover:bg-zinc-800 block px-4 py-2 text-sm text-gray-700 dark:text-gray-100 dark:hover:text-white" role="menuitem" tabindex="-1" id="user-menu-item-1">{m.title}</a>
                        {/if}
                      {/if}
                    {/each}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
        <div class="-mr-2 flex items-center sm:hidden">
          <!-- Mobile menu button -->
          <button type="button" onclick={toggleMobileMenu} class="touch-manipulation relative inline-flex items-center justify-center rounded-md  p-2 text-gray-400 dark:text-gray-200 betterhover:hover:bg-gray-100 dark:betterhover:hover:bg-zinc-800 betterhover:hover:text-gray-500 dark:betterhover:hover:text-white {mobileNavMenuVisible ? 'bg-gray-100 dark:bg-zinc-800' : 'bg-white dark:bg-zinc-900'} focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-2" aria-controls="mobile-menu" aria-expanded="false">
            <span class="absolute -inset-0.5"></span>
            <span class="sr-only">Open main menu</span>
            <!-- Menu open: "hidden", Menu closed: "block" -->
            <svg class="{mobileNavMenuVisible ? 'hidden' : 'block'} h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <!-- Menu open: "block", Menu closed: "hidden" -->
            <svg class="{mobileNavMenuVisible ? 'block' : 'hidden'} h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile menu, show/hide based on menu state. -->
    {#if mobileNavMenuVisible}
      <div in:fade={{ duration: 100, easing: cubicOut }} out:fade={{ duration: 75, easing: cubicIn }}
        use:EscapeOrClickOutside={{ callback: closeMobileMenu, except: menuHeaderBar }} 
        class="sm:hidden select-none absolute left-0 right-0 bg-white dark:bg-zinc-900 z-50 shadow-md dark:border-zinc-600 dark:border-b-2" id="mobile-menu">
        <div class="space-y-1 pb-3 pt-2">
          <!-- Mobile Menu -->
          {#each menu as m}
            <!-- Current: "border-sky-500 bg-sky-50 text-sky-700", Default: "border-transparent text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800" -->
              {#if (page.url.pathname === '/' && m.href === '/') || (m.href !== '/' && page.url.pathname.startsWith('/' + m.href.split('/')[1]))}
                <a href="{m.href}" onclick={closeMobileMenu} class="border-sky-500 bg-sky-50/50 dark:bg-slate-800/25 text-sky-500 block border-l-4 py-2 pl-3 pr-4 text-base font-medium" aria-current="page">{m.title}</a>  
              {:else}
                <a href="{m.href}" onclick={closeMobileMenu} class="border-transparent text-gray-600 dark:text-gray-400 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:text-gray-800 dark:hover:text-gray-200 block border-l-4 py-2 pl-3 pr-4 text-base font-medium">{m.title}</a>  
              {/if}
            {#if m.submenu !== undefined}
              {#each m.submenu as item}
                <a href="{item.href}" onclick={closeMobileMenu} class="flex gap-3 items-center py-2 pl-3 pr-4 text-base font-medium" aria-current="page">
                  <ChevronRight class="w-5 h-5"/>
                  <span>{item.title}</span>
                </a>  
              {/each}
            {/if}
          {/each}
        </div>
        <div class="border-t bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 pb-3 pt-4">
          <div class="flex items-center px-4">
            <div class="shrink-0">
              <Avatar imageId={data.user?.person.imageId} gravatarHash={data.user?.gravatarHash} name={data.user?.person.name} version={data.user?.person.profileImage?.updatedAt} size={40} />
            </div>
            <div class="ml-3">
              <div class="text-base font-medium text-gray-800 dark:text-gray-200">{data.email}</div>
              <div class="text-sm font-medium text-gray-500">{data.email}</div>
            </div>
            <!-- <button type="button" class="relative ml-auto shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-2">
              <span class="absolute -inset-1.5"></span>
              <span class="sr-only">View notifications</span>
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </button> -->
          </div>
          <div class="mt-3 space-y-1">
            {#each profileMenu as m}
              {#if m.button !== undefined}
                <button onclick={() => { closeMobileMenu(); m.button() }} class="w-full text-left block px-4 py-2 text-base font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-800 dark:hover:text-gray-200" role="menuitem" tabindex="-1" id="user-menu-item-1">{m.title}</button>
              {:else}
                {#if m.href !== undefined && page.url.pathname.startsWith(m.href)}
                  <a href="{m.href}" onclick={closeMobileMenu} class="block px-4 py-2 text-base font-medium border-sky-500 bg-sky-50 dark:bg-slate-800/25 text-sky-700 dark:text-sky-400">{m.title}</a>
                {:else}
                  <a href="{m.href}" onclick={closeMobileMenu} class="block px-4 py-2 text-base font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-800 dark:hover:text-gray-200">{m.title}</a>
                {/if}
              {/if}
            {/each}
            <div class="w-full border-t"></div>
          </div>
        </div>
      </div>
    {/if}
  </nav>

  <div
    class="relative -mt-px overflow-y-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
    style="height: calc(100% - 4rem - env(safe-area-inset-top) + 1px); --nav-height: calc(4rem + env(safe-area-inset-top)); --safe-bottom: env(safe-area-inset-bottom);"
  >
    <div class="fixed top-[calc(env(safe-area-inset-top)_+_4rem)] right-0 left-0 z-101 h-0.5 overflow-hidden">
      <!-- <ProgressBar bind:this={progress} minimum={0} bind:width={width} /> -->
    </div>
    {@render children?.()}
  </div>



  {#if aboutOverlay}
    <!-- About. Deliberately small: what this is, where the source lives, and exactly which
         build you are looking at -- the last of which is the only thing here that is hard to
         find out any other way when something misbehaves. -->
    <div
      use:escapeOrClickOutside={{ except: undefined, callback: hideAboutOverlay }}
      in:fade={{ duration: 200, easing: cubicOut }}
      out:fade={{ duration: 75, easing: cubicIn }}
      class="fixed z-50 top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center bg-black/40 p-4"
    >
      <div
        class="relative w-full max-w-md overflow-hidden rounded-3xl bg-white text-sm/6 shadow-lg ring-1 ring-gray-900/5 dark:bg-zinc-900 dark:ring-white/10"
        data-testid="about-dialog"
      >
        <button
          onclick={hideAboutOverlay}
          aria-label="Close"
          class="absolute top-4 right-4 z-50 cursor-pointer text-gray-500 hover:text-sky-500 dark:text-gray-400"
        >
          <X class="size-5" />
        </button>

        <div class="p-6">
          <div class="flex items-center gap-3">
            <!-- The app's own icon, rather than a logo file: one asset, already shipped. -->
            <!-- The icon is white-on-white in light mode, so it needs an edge to read as a tile. -->
            <img
              src="/icon-192.png"
              alt=""
              width="36"
              height="36"
              class="size-9 rounded-lg ring-1 ring-gray-900/10 dark:ring-0"
            />
            <div>
              <p class="font-merienda text-xl font-bold text-gray-900 dark:text-white">Yearbook</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {data.build.packages.svelte === null ? 'A family photo yearbook' : "The family's photographs, a year at a time."}
              </p>
            </div>
          </div>

          <a
            target="_blank"
            rel="noreferrer"
            href="https://github.com/knicholson32/Yearbook"
            class="group mt-5 flex items-center gap-x-4 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-white/5"
          >
            <div class="flex size-10 flex-none items-center justify-center rounded-lg bg-gray-100 dark:bg-white/10">
              <!-- Inline: lucide dropped its brand icons, so there is no GitHub mark to import. -->
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="size-5 text-gray-700 dark:text-gray-200">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </div>
            <div>
              <p class="font-semibold text-gray-900 group-hover:text-sky-700 dark:text-white dark:group-hover:text-sky-400">
                GitHub
              </p>
              <p class="text-gray-600 dark:text-gray-400">View the source and report bugs</p>
            </div>
          </a>
        </div>

        <div class="bg-gray-50 p-6 dark:bg-white/5">
          <div class="flex items-baseline justify-between">
            <h3 class="text-sm/6 font-semibold text-gray-500 dark:text-gray-400">This build</h3>
            {#if data.build.builtAt !== null}
              <time
                datetime={new Date(data.build.builtAt * 1000).toISOString()}
                class="text-xs text-gray-500 dark:text-gray-400"
              >
                built {timeConverter(data.build.builtAt, { dateOnly: true })}
              </time>
            {:else}
              <span class="text-xs text-gray-500 dark:text-gray-400">running from source</span>
            {/if}
          </div>

          {#if data.build.commit !== null}
            <a
              href="https://github.com/knicholson32/Yearbook/commit/{data.build.commit}"
              target="_blank"
              rel="noreferrer"
              class="mt-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:underline dark:text-white"
              data-testid="about-commit"
            >
              <GitCommitVertical class="size-4 shrink-0 text-gray-400" />
              <code class="rounded-md bg-gray-100 px-1.5 py-0.5 font-light dark:bg-white/10">
                {data.build.commit.substring(0, 7)}
              </code>
              {#if data.build.ref !== null}
                <span class="truncate text-gray-500 dark:text-gray-400">on {data.build.ref}</span>
              {/if}
            </a>
          {/if}

          <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs" data-testid="about-versions">
            {#each [
              ['Node', data.build.node],
              ['Svelte', data.build.packages.svelte],
              ['SvelteKit', data.build.packages.kit],
              ['Tailwind', data.build.packages.tailwind],
              ['Prisma', data.build.packages.prisma],
              ['sharp', data.build.packages.sharp]
            ] as [name, value] (name)}
              {#if value !== null}
                <dt class="text-right text-gray-500 dark:text-gray-400">{name}</dt>
                <dd class="text-gray-900 dark:text-gray-200">
                  <code class="rounded-md bg-gray-100 px-1.5 py-0.5 dark:bg-white/10">{value}</code>
                </dd>
              {/if}
            {/each}
          </dl>
        </div>
      </div>
    </div>
  {/if}
{/if}