# Yearbook

A shared family photo yearbook. Each family group uploads a few photos a month, tags the
people in them and writes captions; at the end of a year an admin reviews everything and
publishes it, and the year becomes a fixed book that reads front to back.

Groups see only their own photos while a year is in progress. Published years are visible
to everyone, and are locked: unpublishing is the only way back to editing.

- **Months and groups.** Photos belong to a month and to the group that uploaded them.
  Every group can caption its own month.
- **People.** Anyone can tag anyone, including people in other groups -- tagging someone
  does not reveal that group's photos.
- **Published yearbooks.** A justified-row photo book with captions, cover collages and a
  full-screen viewer (swipe, pinch-zoom, arrow keys). Optionally links to a printed
  photobook.
- **Duplicate detection.** Uploads are perceptually hashed; a likely duplicate is held back
  and named with its uploader, month, caption and tags, with an "upload anyway" escape.
- **Admin dashboard.** The one cross-group view. Counts per year, month and group; a pending
  queue; and ZIP exports of any group, month or whole year as baseline 8-bit RGB JPEGs
  re-encoded from the originals, ordered `year / month / group`.
- **HDR aware.** Gain-map photos are kept intact for display and flattened for export.

## Running it

The image is `keenanrnicholson/yearbook`. It serves on port 3000 and keeps nothing inside
itself -- the database and the photos are two volumes.

```yaml
services:
  yearbook:
    image: keenanrnicholson/yearbook:latest
    restart: unless-stopped
    volumes:
      - ./library/db:/db        # SQLite database
      - ./library/files:/files  # photos, thumbnails, exports
    environment:
      ORIGIN: 'https://yearbook.example.com'
      TZ: 'America/New_York'
    ports:
      - '8080:3000'
```

Migrations run at start; the database is created on first boot.

| Variable | Required | Meaning |
| --- | --- | --- |
| `ORIGIN` | yes | Public URL. SvelteKit rejects form posts from anywhere else. |
| `TZ` | no | Container timezone; affects how photo dates are read. |
| `CF_ACCESS_TEAM_DOMAIN` | no | Access team domain to verify tokens against. |
| `CF_ACCESS_AUD` | no | Access application audience tag. |
| `BODY_SIZE_LIMIT` | no | Upload ceiling, default 11 MB. |
| `FILES_FOLDER` | no | Where photos are written, default `/files`. |

### Authentication

There are no passwords. The app expects to sit behind [Cloudflare
Access](https://developers.cloudflare.com/cloudflare-one/policies/access/), and takes the
signed-in identity from the `Cf-Access-Jwt-Assertion` token, which it verifies against your
team's public keys on every request. Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` to your
own Access application.

A request with no valid token is refused with 403. Anyone signing in for the first time is
asked for their name and group; if someone has already tagged them in a photo, they claim
that person rather than becoming a second copy of them.

Administrators are stored in the database, not configured on the server. **The first account
created on a fresh install becomes an administrator**, and from then on administrators are
granted and revoked from the dashboard. The last one cannot be removed.

> **Put Access in front of it.** The container must not be reachable directly from the
> internet. Its whole notion of who you are comes from the tunnel.

## Developing

The dev server runs in a container; your editor runs on macOS. Those need **two
separate `node_modules` trees**, because the container installs linux/musl arm64
binaries (`@rollup/rollup-linux-arm64-musl`, `@img/sharp-linuxmusl-arm64`) and the
language server needs darwin-arm64 ones.

```sh
# 1. the host tree -- for the editor's language server and for CLIs like prisma.
#    Only needed once, and again whenever pnpm-lock.yaml changes.
pnpm install --frozen-lockfile --ignore-scripts

# 2. the container -- installs its own tree into the `node_modules` named volume
#    declared in docker/docker-compose.dev.yml, so it never touches the host's.
make dev
```

Do not bind-mount `./node_modules` into the container: the container's `pnpm i`
writes straight through it and leaves the host with a linux tree, at which point
the Svelte extension fails to load `svelte.config.js` with

> Cannot find module @rollup/rollup-darwin-arm64

The npm-bug advice in that message is a red herring. If you hit it, run step 1
again and reload the editor window.

`.svelte-kit/` and `generated/prisma/` are generated inside the container and
shared out through the `../:/app` bind mount, so host typechecking sees them.

Both dev and preview run in containers and are reached through a Cloudflare tunnel, since
Access is what supplies an identity:

```sh
make dev       # vite dev on :5173
make preview   # production build, vite preview on :4173
make local     # the built image, via docker/docker-compose.local.yml
```

Running directly on `localhost` works too. With no Access token and a connection from
loopback or a private range, the app falls back to trusting the
`cf-access-authenticated-user-email` header so you can be anyone you like:

```sh
curl -H 'cf-access-authenticated-user-email: you@example.com' http://localhost:5173/
```

That fallback is disabled in the published image, which sets `YEARBOOK_PACKAGED=1`.

Copy `.env.example` to `.env` before running outside a container. `.env` is deliberately not
committed and never enters the image; everything the container needs comes from its
environment.

## Building the image

```sh
make create-local   # keenanrnicholson/yearbook:local, this machine's architecture
make create-all     # multi-arch, pushed
```

`.github/workflows/docker-build.yml` builds and pushes on every push to `main` or `develop`.
`AGENTS.md` has the details, including several ways this build has broken before.

## Stack

SvelteKit 5 (runes) with `adapter-node`, Tailwind 4, Prisma over SQLite
(`better-sqlite3`), and sharp for image processing. Notes on conventions, testing and
architecture live in `AGENTS.md`.
