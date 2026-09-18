You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.


## Working agreements

- Prefer `pnpm` when installing dependencies.
- Ask for confirmation before adding new production dependencies.

## Building and shipping the image

`.github/workflows/docker-build.yml` builds `docker/Dockerfile` (`--target prod`) on every
push to `main` or `develop` and pushes to Docker Hub as `vars.REGISTRY_IMAGE`. The matrix
currently builds `linux/amd64` only; `linux/arm64` is commented out, and the digest
artifacts are named per platform so uncommenting it does not collide.

Things that were wrong here once and are easy to reintroduce:

- **The build must not need a `.env`.** CI has none. Anything read through
  `$env/static/private` is inlined at build time and therefore demands one, so server code
  uses `$env/dynamic/private` instead and the values arrive as container environment
  variables. `.env` is in both `.gitignore` and `.dockerignore`; `.env.example` documents
  what has to be set.
- **`prisma generate` needs `DATABASE_URL` to resolve** because `prisma.config.ts` asks for
  it, even though codegen never opens a database. The build stage sets a placeholder.
- **No query parameters on the SQLite URL.** The Prisma CLI understands
  `file:/db/yearbook.db?connection_limit=1`, but the runtime goes through
  `@prisma/adapter-better-sqlite3`, which passes the whole string to better-sqlite3 as a
  filename. `migrate deploy` then migrates the real database while the server silently
  creates and serves an empty one called `yearbook.db?connection_limit=1`.
- **Server-side packages belong in `dependencies`, not `devDependencies`.** Vite bundles
  devDependencies into the SSR output and leaves real dependencies external. Bundling loses
  any non-JS asset a package loads at runtime: `imghash` (via `@cwasm/nsbmp`) and
  `libheif-js` both ship `.wasm` files, and bundling them produced `ENOENT ... nsbmp.wasm`
  on any page touching the image code.

To check a build the way CI sees it, build from the repository root -- `.dockerignore`
keeps `.env` out, so a local build is already the CI case:

```sh
docker build -f docker/Dockerfile --target prod -t yearbook:test .
docker run --rm -p 4173:3000 -v "$PWD/library/db:/db" -v "$PWD/library/files:/files" \
  yearbook:test
```

Mount copies of `library/` rather than the real thing if the run might write.

## Icons, the manifest, and Access

`src/hooks.server.ts` serves seven paths without resolving a session -- `favicon.ico`, the
four icon PNGs, `manifest.webmanifest` and `robots.txt`. This is not a convenience:

A phone saving the site to its home screen fetches `apple-touch-icon.png` **outside the
browsing session**. Behind Cloudflare Access that request comes back as the login page --
`200 text/html`, not a PNG -- so the fetch fails and iOS draws its own grey letter tile.
The symptom looks like a broken icon file; the icon is fine.

The manifest has a second, separate cause, and it bites even for a signed-in user: a
manifest is fetched with **credentials omitted by default**, same-origin included. Access
sees an anonymous request and redirects to its login host, and the browser then refuses that
cross-origin hop for want of an `Access-Control-Allow-Origin` header:

```
Access to manifest at 'https://<team>.cloudflareaccess.com/cdn-cgi/access/login/...'
(redirected from 'https://<host>/manifest.webmanifest') has been blocked by CORS policy
```

`src/app.html` therefore carries `crossorigin="use-credentials"` on the manifest link, which
sends the session cookie. Do not drop that attribute. There is no equivalent for
`rel="apple-touch-icon"`, so the Bypass policy is still the only fix for the icon itself.

Both sides have to agree. The app allows these paths, and Access needs a Bypass policy for
the same list, or the request never reaches the origin. If someone reports a generated
letter tile instead of the app icon, check this first:

```sh
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://<host>/apple-touch-icon.png
# image/png -> fine.   text/html -> Access is intercepting it.
```

### Store screenshots

`manifest.webmanifest` declares two, and Chrome needs both or it withholds the richer
install dialog: one with `form_factor: "wide"` (desktop) and one without it or set to
something else (mobile). Keep each between 320 and 3840px with a ratio no worse than 2.3:1 --
`screenshot-wide.png` is 1280x800 and `screenshot-narrow.png` is 780x1688.

They are captured from the running app at those viewports, but **every photograph is
replaced with a generated gradient before the capture**. This repository and the published
image are both public; a store screenshot is there to show the layout, not the family in it.
Re-shoot them the same way when the UI changes, and check `document.querySelectorAll('img')`
for any surviving `/api/image/` source before saving.

The About dialog reads `data.build` from `$lib/server/build`, which is computed once at
startup from `package.json` and the environment variables the Dockerfile stamps in
(`GIT_COMMIT`, `GIT_REF`, `BUILD_TIMESTAMP`). Running from source those are absent and the
dialog says "running from source" rather than inventing a version.

## Driving the UI headlessly

The app has no test runner. To check behaviour end to end, drive Chrome over the DevTools
Protocol — Node's built-in `WebSocket` is enough, no dependency needed:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp> about:blank
```

Then connect to the page target from `http://localhost:9222/json/list`.

Two things that will otherwise waste your time:

- **Authentication.** Every route needs the Cloudflare Access header. Set it once with
  `Network.setExtraHTTPHeaders` → `{'cf-access-authenticated-user-email': '<a user id>'}`.
  Without it you get a 307 to `/new-user`. The same header works with `curl` for hitting
  actions and endpoints directly (add `x-sveltekit-action: true` to get an ActionResult
  back from a form action rather than a redirect).
- **Never run `pnpm dev` on the host while the dev container is up.** Both processes write
  the same SQLite file across the bind mount and it corrupts (`SQLITE_CORRUPT`). Stop the
  container first, or just test against the container on `:5173`.

Also worth knowing: `pnpm check` silently drops files it cannot parse and still reports
success, so a broken template shows up as an unchanged error count and a *lower file
count*. `pnpm build` is the real gate for template syntax.

## Test selectors

Interactive elements carry `data-testid` so headless tests do not depend on button text or
Tailwind classes, both of which change constantly. Prefer these over any other selector,
and add a new one rather than reaching for `:nth-child` or matching on copy.

Some carry a second attribute identifying the row, which is what you want when a page has
many of the same thing — `[data-person="<id>"]`, `[data-photo="<id>"]`, `[data-month="<n>"]`.

| Selector | Where | What it is |
| --- | --- | --- |
| `dropzone` | Dropzone | The drop target region |
| `dropzone-input` | Dropzone | Hidden file input — use `DOM.setFileInputFiles` on this |
| `dropzone-browse` | Dropzone | "browse" link that opens the picker |
| `month-card` | `/upload` | A month tile; also `[data-month]` |
| `pending-card` | `/upload` | Link to the pending queue (only when non-empty) |
| `year-select` | `/upload` | Year dropdown |
| `month-caption` | `/upload/[year]/[month]` | The group's note textarea; saves on blur |
| `month-caption-form` | `/upload/[year]/[month]` | Its form |
| `month-caption-save` | `/upload/[year]/[month]` | Visually hidden submit, for keyboard save |
| `photo-tile` | `/upload/[year]/[month]` | A photo in the grid; also `[data-photo]` |
| `misfiled-badge` | `/upload/[year]/[month]` | Capture-date mismatch marker |
| `photo-dialog` | PhotoDialog | The dialog itself |
| `photo-caption` | PhotoDialog | Caption textarea |
| `photo-full` | PhotoDialog | The full-size photo. Two blurred placeholders precede it (a `object-cover` backdrop and an `object-contain` one aligned to the real image), so select this rather than `img` |
| `photo-save` / `photo-cancel` | PhotoDialog | Footer buttons |
| `photo-delete` | PhotoDialog | Delete (only when you may manage the photo) |
| `move-prev` / `move-next` | PhotoDialog | Shift a month back or forward |
| `move-apply` | PhotoDialog | Apply the month/year picker |
| `people-search` | PeoplePicker | Filter box |
| `person-option` | PeoplePicker | A taggable person; also `[data-person]` |
| `picker-add-person` | PeoplePicker | "Add someone new" toggle |
| `pending-photo` | `/upload/[year]/pending` | A pending photo; also `[data-photo]` |
| `assign-month` / `assign-year` | pending | Destination inputs |
| `assign-submit` | pending | File that one photo |
| `assign-all` | pending | File everything by capture date |
| `person-row` | `/profile` | A group member; also `[data-person]` |
| `person-photo-button` | `/profile` | Add/change that person's picture |
| `person-reframe` | `/profile` | Open the cropper for that person |
| `person-remove` | `/profile` | Remove (absent for people with accounts) |
| `self-photo-button` / `self-reframe` | `/profile` | Same two, for the signed-in user |
| `add-person-name` / `add-person-submit` | `/profile` | Add someone without an account |
| `confirm-remove-dialog` | `/profile` | Removal confirmation |
| `confirm-remove-yes` | `/profile` | Confirm the removal |
| `crop-dialog` | CropDialog | The cropper |
| `crop-area` | CropDialog | Draggable square; arrow keys nudge it |
| `crop-size` | CropDialog | Size slider |
| `crop-apply` / `crop-cancel` | CropDialog | Footer buttons |

### The book page follows the theme

`/years/[year]` uses the normal theme background: light in light mode, dark in dark mode. It
was briefly forced dark (a `dark` class on the article plus a head style) to hide a white
flash, which was wrong for light mode, where white is simply the page. The body's background
is already themed before first paint by mode-watcher's inline head script, so neither mode
flashes the other's colour. Only the cover is dark in both.

### Dev server: intermittent crash on an aborted request

Once, during a heavily throttled CDP test (cache disabled, 400kbps, screencast running), the
dev server exited with an uncaught `TypeError [ERR_INVALID_STATE]: ReadableStream is already
closed` from Node's internal undici. It did not reproduce on demand: three identical replays,
and deliberately aborting large `/api/image/.../original` downloads mid-stream, all left the
server up. If the container exits with that error, `docker start yearbook-dev` brings it back.
Not yet known whether it affects a production (`adapter-node`) build.

### Cover collages have fixed tracks

Both collages -- the yearbook page's cover and each shelf cover -- use **explicit** rows and
columns (`grid-cols-* grid-rows-*`), with each photo `absolute inset-0` inside a
`relative min-h-0 min-w-0` cell. With auto rows, a row took its height from the photos in it,
so the collage re-flowed each time another image finished loading. Absolute positioning keeps
an image's intrinsic size from reaching the track at all.

The yearbook cover uses **six** photos because six fills 2x3 (phone), 3x2 (tablet) and 6x1
(desktop) exactly; changing a breakpoint's column count means checking that again. Which six
is deterministic: `coverPhotos` samples evenly across the year's photos in reading order.

To verify, measure every cell with `Network.setBlockedURLs(['*/api/image/*'])`, then again with
images loaded; the rects must be identical.

### Shelf covers are embedded in the page

The ghosted photos on each shelf cover travel inside the HTML as `data:` URIs
(`publishedYears` -> `embedCover`), so the covers are complete in the first paint instead of
popping in. Verified: 0 `/api/image` requests on shelf load, all thumbnails decoded by
DOMContentLoaded.

The embedded copy is a ~200px WebP re-encoded from the stored 256 derivative, not the stored
bytes. For HDR photos that derivative is a gain-map JPEG (~50kB), and SvelteKit writes page
data into the HTML **twice** (markup plus hydration payload) -- embedding the stored bytes put
a one-book shelf at 556KB. Re-encoded, each is 5-10kB. Encodes are cached in memory by
`id:updatedAt`, so a restart is needed to see a change to the encoder.

`.rotate()` runs before the resize: some derivatives keep an EXIF orientation tag, WebP drops
it, and without applying it first the rotated photo embedded sideways.

The `<img>` has no `srcset` and no `loading="lazy"` on purpose; either sends the browser back
to the network for another copy and brings the pop-in back.

### The printed photo book link

`Year.photobookUrl`, set from the admin year page and shown under the cover on the shelf.

It has its **own action**, not a field on the publish form: a book is ordered after the year
is finished, so the link has to be settable while the year is published -- and everything on
the publish form can only be submitted by publishing or unpublishing.

The URL is validated by **scheme allow-list** (`http`/`https`), not by pattern. It becomes an
`href`, and `javascript:` in one is how a link turns into a script. Empty clears it.

On the shelf the link sits *outside* the cover's `<a>`: a link inside a link is invalid, and
the two go to different places anyway.

### Installing to an iOS home screen

`static/manifest.webmanifest` plus the `apple-*` meta tags in `src/app.html`. **iOS ignores
most of the manifest** -- a home-screen install reads `apple-touch-icon`,
`apple-mobile-web-app-capable`, `apple-mobile-web-app-title` and
`apple-mobile-web-app-status-bar-style` instead, so those tags are not redundant with it.

Icons are an uppercase "Y" in Merienda bold (the header wordmark's face and weight), drawn by
headless Chrome from `static/fonts/Merienda-VariableFont_wght.ttf` -- the container has no
fontconfig, so sharp cannot render text. `favicon.ico` (16-256px) is the Y on a white circle
with transparent corners, so it reads on a dark browser tab. The app icons (`apple-touch-icon`,
`icon-192`, `icon-512`) are the Y on a **full-bleed opaque white square**: iOS applies its own
rounded mask, and a round or transparent icon shows a ring or black corners inside the tile.
`icon-maskable` draws the Y smaller (46% vs 58%) because Android crops maskable icons to a
circle.

Touch icons are flattened with `removeAlpha()`: iOS composites a transparent icon onto black
rather than onto the intended ground. A home-screen install caches its icon -- remove and
re-add the app to see a new one.

**Pinch-zoom is off below `lg` (and in the installed app at any size), via two mechanisms.**
The viewport meta is what Chrome on Android and an installed iOS app obey; **Safari in a
browser tab has ignored `user-scalable=no` since iOS 10**, so the WebKit `gesture*` events are
cancelled as well -- the meta alone changes nothing there. Double-tap is a third gesture,
handled by `touch-action: manipulation` on `body`.

Desktop keeps its zoom: locking it in a wide browser window is an accessibility regression for
no gain. The media query is watched, so resizing across the breakpoint keeps in step.

**The status bar style is `default`, and that is deliberate.** `black-translucent` draws the
status bar over the page with *white* text, which is invisible against this app's white nav in
light mode -- padding does not fix that, only moving the bar out of the way does. `default`
gives the status bar its own space and lets iOS colour it.

`viewport-fit=cover` still applies, and the layout still pads with `env(safe-area-inset-*)`:
the top inset resolves to zero under `default`, but the bottom (home indicator) and the sides
(the notch's shoulders in landscape) do not.

The **nav** carries the top inset, not the content below it. Padding the content leaves the
nav's own logo and avatar under the clock. The nav therefore has no fixed `h-16`; its height
is the inset plus the 4rem bar inside it, and the content's height calc subtracts both.

Anything `position: fixed` escapes the layout's padding and has to inset itself --
`PhotoViewer` does, since its close button would otherwise sit under the status bar.

`src/app.html` is **cached by the dev server**. Editing it changes nothing until
`docker restart yearbook-dev`, and the served HTML keeps the old `<head>` in the meantime.

### Checking HDR on a device

`/admin/hdr` renders one HDR photograph under several named CSS conditions with an SDR photo
beside it as a reference. Whether Safari grants extended dynamic range is a property of how
the compositor drew the frame -- it is not visible in the DOM and **cannot be asserted from
the CDP harness**. The bench exists so the question becomes "which labelled tile looked
bright", which a person can answer from the phone.

**A full-viewport `backdrop-filter` over a photograph costs it HDR on iOS.** An element that
samples its backdrop forces that backdrop to be rasterised, and Safari composites the result
in SDR, tone-mapping any HDR photograph inside it. Confirmed on device: removing the viewer's
blurring backdrop brought HDR back.

The size matters, and this was measured rather than assumed. A **small** `backdrop-filter`
sibling -- a badge in the corner of an image -- does **not** break it; the badges on the month
grids are fine. It is the full-screen blurring layer that does. Do not generalise this into
"no backdrop-filter anywhere"; the app uses several harmlessly.

The tell is oddly specific and worth recognising: the photo looks HDR *while a transition is
running* and flat once it settles. Svelte animates via generated CSS `@keyframes`, and a
running animation promotes the element to its own compositing layer -- escaping the
backdrop-filter group -- so HDR comes back for exactly as long as the animation lasts.

`PhotoViewer` and `PhotoDialog` are therefore free of `backdrop-blur`, and the photo dialog
passes `backdrop-filter-none` to the shared dialog overlay, which blurs by default. Over a
near-opaque ground the blur was invisible anyway.

`/admin/hdr` is the bench this was found with: full-screen overlay variants that differ by one
ingredient each, plus known-good HDR and SDR references. Whether Safari granted extended
dynamic range is invisible to the DOM and **cannot be asserted from the CDP harness**, so if
this ever regresses, that page is the instrument -- a person looks at it on the phone.

### Stale route manifest in the dev container

Symptom: a `TypeError` from a page component that is not the page you are on -- classically
`Cannot read properties of undefined (reading 'length')` from
`upload/[year]/[month]/+page.svelte` while loading `/upload`. The component really does render,
with the *other* route's `data`, so any field only that route returns is undefined.

Cause: SvelteKit addresses route components by number (`.svelte-kit/generated/client/nodes/N.js`).
**Adding a route renumbers every node after it.** The container's dev server keeps its cached
module graph, while host-side `pnpm build` / `pnpm check` rewrite `.svelte-kit/` underneath it
-- so the server's route table and its modules end up off by one and `/upload` mounts the
month page.

Diagnose by comparing the two directly; an off-by-one here is conclusive:

```
for n in 6 7 8 9; do curl -s "http://localhost:5173/.svelte-kit/generated/client/nodes/$n.js" | grep -o "routes/[^'?]*"; done
grep -o "routes/[^']*" .svelte-kit/generated/client/nodes/*.js
```

Fix: `docker restart yearbook-dev`. Do **not** "fix" it by guarding the component
(`data.images?.length`) -- that hides a broken dev state and the next symptom will be subtler.
It is dev-only; a production build has a single consistent manifest.

### Visibility

What is private is a group's **content**: photos, and month captions. `visibleImagesWhere(user)`
in `$lib/server/auth` is the single definition; **spread it into every query that lists or
counts photos**, or a page will quietly show another family's pictures. Admins are *not*
exempt — see the admin section.

**Taggable people are deliberately not scoped.** Groups mix at the events these photos come
from, so a photo often contains people from another family and has to be able to say so. Any
user may tag any person; the `details` action has never restricted which ids it accepts, and
the picker lists everyone. Do not "fix" this by scoping the people query — that is a
requirement, not an oversight. The families list *is* scoped, because it only decides which
group a newly added person joins.

When testing isolation, set up two users in different families and assert both directions:
that each sees their own photos and captions, *and* that neither page shows the other's
pictures. Names are a poor isolation signal now that the picker is shared — assert on photo
tiles and caption text instead.

### AVIF encoding cost

`sharp`'s default `effort: 4` sits just past a cliff in libaom's speed/size curve. Measured
on a 12MP photo at 2048px: effort 4 takes **1.71s**, effort 3 takes **0.42s**, for the same
455KB. The pipeline uses effort 3. Do not raise it without re-measuring -- it is most of an
upload's wall time.

### Measuring photo size

`naturalWidth` on a `srcset` image is *density-corrected*: the browser lays the photo out
at whatever `sizes` claims, not at the file's real pixel width. An understated `sizes` will
silently shrink the photo and look like a CSS bug. When changing the dialog's width, update
`sizes` in `PhotoDialog.svelte` to match the pane, and verify by measuring
`[data-testid=photo-full]` against the `.photo-pane` width.

### Published yearbooks (the Years tab)

`/` is the shelf of covers; `/years/<year>` is one book. Both are open to any signed-in user.

**A published year shows every group's photos to everyone.** That is the point of publishing
-- the finished book is the shared artefact -- and it is the one deliberate exception to
group scoping besides the admin dashboard. `src/lib/server/yearbook/` never spreads in
`visibleImagesWhere`. Publishing is the consent step, and only an admin can do it.

`publishedYearbook()` returns null for an unpublished year, so the route 404s without a
second check -- there is no separate guard to forget. Unpublished years 404 for admins too;
there is no preview back door. `publishedAt` is kept when unpublishing, so a year that goes
back up keeps the date it first appeared.

**Publishing freezes the year.** No edits, deletes, reordering, refiling, month captions or
new uploads while it is on the shelf -- for admins too; unpublishing is the way back in and
restores everything. `$lib/server/yearbook/lock.ts` is the single decision: `isYearLocked`,
`isImageLocked` (which counts a year's *pending* photos as belonging to it), and
`LOCKED_MESSAGE`.

Anything that moves a photo has to check **both ends** -- a photo must not leave a published
book, nor drop into one -- so `moveToMonth`, `refile` and the pending `assign` each check the
destination year separately from the source.

Refusals use `fail(423)`. Note that a SvelteKit action's HTTP status is still 200: the 423 is
in the response body, which `use:enhance` unwraps, so test the body and not `%{http_code}`.

The pages fold the lock into `canManage`, which every edit control already keys off, so no
template needed changing -- but that is a courtesy. The server checks are what hold.

Because `canManage` now carries two reasons, `PhotoDialog` also takes `locked` so it can say
which one; otherwise a published year shows "Uploaded by someone else" over your own photo.
`PeoplePicker` takes `disabled` for the same reason -- a checkbox that ticks and then silently
does nothing is worse than one that plainly will not.

The publish form's cover-title field only renders while a year is unpublished, since it shares
the form with the publish button and could not be saved on its own. That makes *absent* and
*empty* different: `setPublished` leaves the stored title untouched when the field is missing,
and only clears it when the field is present and blank. Reading a missing field as `''` erased
the title on every unpublish.

Layout lives in `src/lib/yearbook/layout.ts`, pure and deterministic -- the same photos
always produce the same book, which is what makes a visual check meaningful.

Two rules it exists to enforce, both easy to break by accident:

- **Nothing is cropped to a foreign aspect ratio.** Rows are justified: the row's
  `aspect-ratio` is the sum of its photos' aspect ratios, and each photo grows by its own
  aspect (`flex: <aspect> 1 0`). Grow factors, not width percentages -- percentages are of
  the full row *including* gaps, so they overflow by the gap total. Measure this by comparing
  each `img`'s rendered box ratio against `naturalWidth/naturalHeight`; gap rounding leaves
  ~2%, anything more is a real bug.
- **A short trailing row must not be justified** (`fill: false`). Stretching a lone photo to
  a full row's width crops away most of it -- this measured 132% before it was fixed. Such a
  row keeps a normal height and ends short, like the last line of a paragraph.

Features (full-width photos) are spaced at least three photos apart, or a month where
everything is captioned becomes a column of full-width images rather than a book.

Clicking any photo opens `PhotoViewer`, which pages the **whole year** in reading order, not
just the row that was clicked -- the book page flattens `months -> blocks -> photos` to rebuild
that sequence. Arrow keys page, Escape closes, neighbours are preloaded.

The viewer is a **filmstrip**: three slides exist at a time (previous, current, next), each
positioned from its distance to the current index, so changing the index moves them all with
one CSS transition. A drag and a button press are therefore the same motion. Slides are keyed
by photo id so the one that was "next" *survives* as the new "current" -- a replaced node has
nowhere to animate from.

**It never waits on the network.** Each slide paints the 128px thumbnail (a database blob,
~2KB) blurred, with the full photograph fading in over it once decoded. An earlier version
held the previous photo until the next had decoded, which is what read as the viewer locking
up on a large file; measured, a step now moves in **1ms** on a throttled link.

Swipe: touch handlers on the overlay, axis decided once from the first meaningful movement
(otherwise a diagonal swipe flickers), resistance past either end, and a threshold of a
quarter-screen with a floor so a small phone does not need a huge swipe.

When testing, dispatch real touches with `Input.dispatchTouchEvent` in several steps -- a
single jump does not produce a drag.

While the viewer is open the page behind it is frozen with `overflow: hidden` and
`overscroll-behavior: none` on `<html>` and `<body>` -- **not** by pinning the body with
`position: fixed`. Pinning made iOS Safari bring a collapsed toolbar back, shrinking the
viewport just after the viewer opened and shifting the centred photo up. Touch scrolling is
already impossible through the full-screen viewer (`touch-action: none`), so the overflow
lock only has to stop wheel and keyboard scrolling.

The photo box stays at `opacity: 0` until a real shape has been measured from an image, so a
rotated photo never opens at its (wrong) stored size and then jumps. The placeholder is kept
until the full photo's fade-in has *finished* plus a 700ms grace period (`transitionend`, with
a 1400ms timeout for reduced motion), and the fade starts only after `decode()`.
`transitionend` fires when the style reaches opacity 1, which can precede the compositor
actually painting a large HDR photo; removing the placeholder right at `transitionend` still
flashed black occasionally on device. Under an opaque photo the placeholder is invisible, so
the long margin costs nothing -- removing the placeholder at the start of
the fade showed the black backdrop through a half-transparent photo.

Each slide holds a box with the photograph's **decoded** shape, clipping both images to it.
There is deliberately **no CSS `filter: blur()`** on the placeholder: a full-screen blur is
among the most expensive things a phone compositor can animate, and letting it spill past the
photo's edges was the "glow". The placeholder is removed once the full image loads.

**Stored `width`/`height` cannot be trusted for shape.** Some gain-map JPEGs keep an EXIF
orientation tag instead of having the rotation baked in, so a portrait photo is recorded as
4032x3024 but displays as 3024x4032 (`27013c13` is one, orientation 6). The viewer sizes its
box from `naturalWidth`/`naturalHeight`, which honour orientation. The book layout in
`layout.ts` still uses the stored numbers and is affected -- see the open issue below.

Frame-rate checks from the CDP harness measure the main thread only (rAF deltas). They came
back a clean 60fps at 4x CPU throttling both before and after the compositor changes, so they
cannot confirm a GPU-side improvement on iOS; that needs a look on the phone.

**Zoom inside the viewer is the viewer's own, not the browser's.** Page pinch-zoom is locked at
mobile sizes, so the photo zooms with a CSS `scale` on the current slide's box: pinch (about
the point between the fingers), one-finger pan while zoomed, double-tap to 2.5x and back.
One gesture owns a touch at a time -- two fingers is always pinch, one finger is pan when
zoomed and swipe-to-page only at 1x. Pan is clamped so an edge stops at the screen edge. Zoom
resets whenever the index changes. Verify with `visualViewport.scale` staying at 1.

A tap **on the photograph** calls `preventDefault` on `touchend`. Without it the browser turns
the first tap of a double-tap into a click on the full-screen close backdrop and the viewer
closes before the second tap. Taps on the dark surround still close. When testing a desktop
"click the surround" case, avoid the vertical middle of the left and right edges -- that is
where the previous/next arrows sit.

**Closing on touch is decided by the gesture code, never by a synthesized click.** Every
touch the viewer handles cancels its click on `touchend`, and the viewer closes only on an
unmistakable tap on the surround: one finger, under 6px of movement, not zoomed, and both the
start *and* the end point off the photo. Relying on the browser's click on the full-screen
backdrop closed the viewer whenever a swipe happened to start or finish off the photograph.
The backdrop's own `onclick` still closes for a mouse, but ignores a click within 800ms of a
touch -- that is the browser's echo of the touch, not a click -- and ignores any click inside
the current photo's box. The slides are `pointer-events: none` so drags reach the gesture
handlers, which means a click on the photograph lands on the backdrop; only the black margin
should close. When testing, find the margin from the box rect: a landscape photo at 1280x900
fills the full height and only has black at the sides.

Touches that **start on a control** (close, arrows) bypass gesture handling entirely. The tap
fix above cancels the synthesized click, and applying it to a button -- as happened while
zoomed in -- means the button silently stops working. The backdrop carries `data-backdrop`
so it is not counted as a control.

Swipe-to-page fires on a drag of a tenth of the screen (floor 36px), **or** on any swipe over
in under 300ms once it has moved 20px. The flick rule is duration-based on purpose: browsers
coalesce touch events (a fast swipe may arrive as three or four samples) and a finger slows
before lifting, so a release-velocity test missed the quick swipes it was meant for.

The book cover fills the screen below `lg` with `min-h-[calc(var(--app-height,100svh)-var(--nav-height))]`.
The cover's height also adds `env(safe-area-inset-bottom)`, and its text is padded by it. In
the installed app the page runs behind the home-indicator strip; without the inset the cover
stopped just above it and left a bar. This cannot be reproduced in the CDP harness, which has
no safe-area insets -- check it on a phone.

In the installed app, `--app-height` is `max(innerHeight, screen height in the current
orientation)`. Measuring `innerHeight` alone -- with or without adding the bottom inset --
still left a white bar on a real home-screen install, so the physical screen height is the
floor. Where the web view starts below the status bar this overshoots by that bar's height
(59px simulated), which only puts the bottom of the cover past the fold; the cover's text is
padded clear of it. iOS does not swap `screen.width`/`height` on rotation, hence the
orientation check. Superseded wording below describes the earlier attempt:

In the installed app, `--app-height` is `window.innerHeight`, published from app.html: iOS
reports viewport units short in home-screen mode, which left a gap under the cover even
though the same page filled correctly in a browser tab. It is only set when installed,
because in a tab `innerHeight` changes as the toolbar collapses.
`svh` rather than `dvh` so the cover does not resize as Safari's toolbar collapses on scroll;
`lg` rather than `sm` so a phone held sideways -- wider than `sm` -- gets it too.

Superseded: stepping used to be a blur cross-dissolve, not a swap. Two things make that work, and both matter:
the image is inside `{#key shown.id}` so a step builds a *second* element (changing `src` on
one element leaves nothing to dissolve from), and `shown` trails `current` until the incoming
photo has **decoded** -- otherwise the dissolve plays against a blank frame, which is the pop
it exists to remove.

Neighbours are fetched *and decoded* programmatically. Hidden `<img>` elements download but
do not decode while `display: none`, and decoding a 4032px photo is the slow half: that
change took the click-to-dissolve delay from ~180ms to ~25ms.

When testing this, dispatch real key events (`Input.dispatchKeyEvent`). A
`new KeyboardEvent('keydown')` defaults to `bubbles: false`, never reaches the
`<svelte:window>` handler, and looks like the dissolve is broken for keyboard paging.

The viewer image is `size-full object-contain` over the full window with **no background
colour**. That is deliberate: the box is wider or taller than the photograph by design, so a
tint shows up as coloured bars down its sides. Do not give it `width` plus `aspect-ratio`
either -- an explicit width wins over the ratio, the box stops matching the photo, and the
bars come back.

Selectors: `shelf`, `shelf-empty`, `aurora`, `yearbook-cover`, `yearbook-month`,
`yearbook-feature`, `book-photo`, `photo-viewer`, `viewer-image`, `viewer-caption`,
`viewer-prev`/`viewer-next`, `viewer-close`, `viewer-position`, `prev-year`/`next-year`,
`publish-panel`, `toggle-published`, `year-title`.

### Image sizes and pixel density

`srcset` uses `w` descriptors throughout, so the browser already multiplies by
`devicePixelRatio` when choosing -- there is no need for `2x` descriptors. What matters is
that the candidate list reaches high enough: a tile 480 CSS px wide needs a 960px candidate
on a 2x screen. Check with the largest layout a page can produce (the month grid at a
one-column setting makes a tile the full 60rem).

Build lists with `srcsetFor(id, naturalWidth, from)` in `$lib/image`, which adds
`/full` described by the photograph's **real width**. Past 2048 there is no other candidate,
so without it the browser can only upscale. It also drops candidates larger than the
photograph: derivatives are built `withoutEnlargement`, so a 900px original's "2048" is
really 900px, and advertising it as 2048w promises detail that is not there.

The `/128` placeholders in `PhotoDialog` and the cropper's `/uncropped` have no `srcset` on
purpose.

To verify, walk every `img[src*="/api/image/"]` at `deviceScaleFactor` 1 and 2 and compare
`parseInt(currentSrc.split('/').pop())` against `boundingRect.width * devicePixelRatio`.

### The admin pending queue

`/admin/[year]/pending` files photos that arrived without a month, across **every** group --
the warning on the admin dashboard counts all groups, so it would otherwise name photos the
admin could not reach. The group's own `/upload/[year]/pending` stays scoped.

Actions are shared through `pendingActions({ allGroups })`; only the bulk sweep differs, since
`assign` and `delete` authorize per photo through `canManageImage`, which already lets an
admin through.

`datedFromExif` is returned at upload but **never stored**, so after the fact a photo that
fell back to the file's modification time is indistinguishable from one the camera dated.
The bulk action therefore cannot promise it files by capture date; each row shows the date it
would actually use instead.

### Duplicate detection

A duplicate is **refused by default**: the endpoint answers `409` and stores nothing. The
uploader sees a warning with an "Upload anyway" button, which re-sends the same `File` with
`allowDuplicate=true`.

The check has to happen *inside* the pipeline, via the `checkDuplicate` option on
`uploadImage`. The perceptual hash is taken from the finished full-size render, so it does not
exist any earlier -- but the derivatives are on disk by then, which is why the veto unlinks
them by hand before returning. There is no image row at that point for `deleteImages` to work
from. Verify a refusal with row and file counts either side; both must be unchanged.

The held-back file stays in the browser and its preview is a `blob:` URL, because the photo
was never stored and has no URL on the server. Revoke it when the warning is dismissed or a
new drop replaces it.

`Image.hash` is perceptual (imghash), not a checksum, so it survives re-encoding and
resizing -- a photo sent once from Photos and once through a messaging app still matches at
distance 0 (verified). The cost is that it can also match two frames of the same burst, which
is why this is only ever a warning. Threshold is 5 of 64 bits.

Hamming distance cannot be expressed in a SQLite `where`, so candidate id+hash rows are
compared in memory. That is fine at a family yearbook's scale; a very large library would want
a hash prefix index, not a different algorithm.

The warning shows both photographs side by side, the upload and the match. A drop of several
files produces several warnings, and a filename rarely says which picture is meant -- seeing
them together also shows at a glance whether a near-match is genuine.

It deliberately offers **no way to open the existing photo**. The thumbnail, uploader, month,
caption and tags are enough to recognise it; the match's `year` and `month` are therefore not
sent to the client at all, only the `filed` label built from them. Do not add a link back.

**The warning reaches across groups on purpose** -- it names the uploader, the month, the
caption and the tagged people, whichever family they belong to. A duplicate is only useful to
know about if it covers the whole book. This is the one cross-group disclosure outside the
admin area and a published yearbook.

### The shelf background

Chosen by the `years.background` setting (`plain` | `aurora`), switchable from the profile
page's Display section -- so trying an alternative never means editing the page. `plain` is
the default; the aurora is kept and one click away. A value outside the list falls back to the
first entry, which is what retires a removed variant safely.

Four blurred washes behind `/`, coloured from the published years' own photos. The saturation
uses `clamp(0.11, calc(c * 5), 0.19)` -- a **floor**, not just a ceiling: averaging many
photos lands near neutral, where chroma is almost zero and multiplying it still leaves grey.
Each wash also rotates the hue by `--dh`, so a shelf holding a single book still gets four
colours rather than four identical discs.

### Settings and who may change them

Most settings on the profile page are site-wide but editable by any signed-in member --
`upload.monthColumns` and `years.background` only adjust a view. `general.familyName` names
the household, so its action calls `requireAdmin` and the control is hidden for everyone
else. A new setting needs that decision made explicitly; the page is not admin-only.

### Admin dashboard and exports

`/admin` (year, via `?year=`) and `/admin/<year>/<month>`. Gated by `requireAdmin`, which
answers **404**, not 403 -- a normal user must not learn the area exists.

Admin lives in `User.role` in the database and nowhere else; there is no environment
variable for it. The first account created while no administrator exists is made one (the
check runs inside the signup transaction, so two simultaneous first signups cannot both
win), and after that the `setAdmin` action on the dashboard grants and revokes. It refuses
to demote the last administrator: nothing in the app can put one back.

These pages are the one place that deliberately ignores `visibleImagesWhere`. Everything in
`src/lib/server/export/stats.ts` queries across every family. Only call it behind
`requireAdmin`.

The admin month view shows **every group's month caption**, under that group's heading. A
group only ever sees its own on its own month page; this is the one view that reads them
together, so each is attributed with its author and date rather than run in as plain text.

A caption can exist for a group with **no photos** in that month -- writing one creates the
month row on demand, so a group can describe a month before filing anything into it. Those
groups are folded into the listing rather than dropped, or the caption would be written and
then invisible. They are listed but not counted in "photos from N groups".

**Admins are not exempt from `visibleImagesWhere`.** The Upload and Years pages show a group's
own photos even for an admin -- otherwise an admin filing their family's photos wades through every
other group's. The admin dashboard reaches across groups by querying without the fragment,
never by widening it. `canManageImage` still returns true for an admin, which is what lets
the dialog edit another group's photo from `/admin`.

`requireAdmin` in a `load` does **not** protect that route's form actions: actions do not run
loads. `/admin/[year]/[month]` wraps each handler individually. Any new admin route with
actions must do the same, or `POST /admin/...?/whatever` answers normally for any signed-in
user.

The photo dialog's form actions live in `src/lib/server/image/photoActions.ts` and are spread
into both `/upload/[year]/[month]` and `/admin/[year]/[month]` -- shared so the authorization
cannot drift between the two. Both routes are `[year]/[month]`, which is what lets the
handlers read `params` the same way from either. `PhotoDialog` posts to whatever page it sits
on; its `basePath` prop only says where "the same photo, next month" lives after a move.

Export selectors: `export-start`, `export-download`, `export-progress`, `export-summary`,
`export-failed`, `export-error`, plus `export-year` / `export-month` / `export-group-<id>`
on the wrappers. Page selectors: `year-total`, `month-total`, `admin-group`, `admin-people`,
`admin-month`, `admin-photo` (a button, not a link -- it opens the dialog in place),
`admin-pending`, `photo-uploader`, `group-faces`.

Exports run as background jobs held **in memory** (`src/lib/server/export/index.ts`), so a
dev-server restart loses them and the progress endpoint 404s -- that is expected, not a bug.
Archives land in `<files>/exports` and are swept after 6 hours.

The archive format is a hand-written STORE-only ZIP (`export/zip.ts`), not a dependency: the
payload is JPEG, so deflate buys nothing. It emits ZIP64 past 4GB or 65535 entries. Verify a
change to it with `unzip -t`, which validates every CRC.

Export JPEG target: baseline **SOF0**, 8-bit, 3-channel sRGB, no ICC, no gain map, at the
original's own dimensions. `nonCompliantReason` decides whether the stored original can be
copied byte for byte instead of re-encoded; check that with `shasum`, not by eye. To verify
the output, scan for the SOF marker directly (sharp does not report it) and use the compiled
Swift `hdrcheck` as an independent oracle -- it reports `gainmap=NONE` on a good export.

The dialog's close button has no testid -- it comes from `dialog-content.svelte`, not this app.
Select it as `[data-slot=dialog-close]`. A bare `button[type=button]` inside the dialog picks a
content button instead, which *does* scroll, so a pinning check will report a false failure.

Below `lg` the scroller is the `div` inside `[data-testid=photo-dialog]`, not the dialog: the
close button is a child of the dialog, so scrolling the dialog itself would carry it off screen.
Set `scrollTop` on that inner div.

### Image URLs in tests

`/api/image/<id>/<size>` takes `full`, `2048`, `1024`, `768`, `512`, `256`, `128`,
`original`, and `uncropped`. `256` and `128` are database blobs; the rest are files. Three
are worth knowing:

- `uncropped` renders the whole original, ignoring any stored crop, and decodes HEIC
  server-side. It is what the cropper displays — framing against a normal derivative would
  compound, because derivatives are built *from* the crop.
- `2048` exists for the photo dialog on large high-density displays, where `1024` visibly
  upscales. The dialog offers 768/1024/2048 in its `srcset` and lets the browser choose; on
  a cold cache it picks 768 below ~1200 device pixels and 2048 above.
- Avatar URLs carry `?v=<Image.updatedAt>`. Derivatives get rebuilt in place, so without it
  the browser keeps serving its cached copy. Assert the version *changes* after a crop
  rather than asserting a fixed URL.
