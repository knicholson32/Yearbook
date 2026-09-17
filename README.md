# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

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

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
