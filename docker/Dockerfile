# Project arguments
ARG NODE_VERSION=24.21.0
ARG USR_LOCAL_EXPORT=/export-usr-bin
ARG ROOT_EXPORT=/export-root
ARG SERVER_PORT=3000

ARG PARENT_IMAGE=node:${NODE_VERSION}-alpine3.23


FROM ${PARENT_IMAGE} AS node_install


######### Dev Stage ################################################################################
FROM ${PARENT_IMAGE} AS dev
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Warm the pnpm store so the `pnpm i` in docker-compose.dev.yml is mostly offline.
# The manifests must be present before `pnpm fetch` runs -- it is a headless install
# and reads the lockfile from the working directory.
#
# Fetch from /fetch, not /app, so the image ships no /app/node_modules. The dev and
# preview compose files mount a named volume there and Docker seeds a fresh volume
# from the image; `pnpm fetch` leaves behind a .modules.yaml with `hoistPattern: []`,
# which does not match the `pnpm i` those containers run, so pnpm would stop and ask
# permission to purge the directory -- hanging the container on a prompt. Only the
# store at $PNPM_HOME/store matters for warmth, and it is unaffected.
WORKDIR /fetch
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

WORKDIR /app

######### Node Modules & Build #####################################################################
FROM ${PARENT_IMAGE} AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy the application and move to the copied folder
WORKDIR /app

# Fetch into the store first, off the manifests alone, so this layer caches across source edits.
# No --prod here: the build needs devDependencies (vite, svelte-kit, ...).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

COPY ./ /app/

# `prisma generate` loads prisma.config.ts, which requires DATABASE_URL to be resolvable.
# Code generation never opens the database, so a placeholder satisfies it; the real value
# arrives as an environment variable at run time. Without this the build depends on a
# developer's .env being in the context, which CI does not have.
ENV DATABASE_URL="file:/tmp/prisma-codegen-placeholder.db"

# Install node modules
RUN echo "---- INSTALL NODE MODULES ----" \
  && pnpm i --offline && pnpm exec prisma generate

# Build the SvelteKit project
RUN echo "---- BUILD SERVER ----" \
  && ORIGIN=${ORIGIN} PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host pnpm run build


######### Production Stage #########################################################################
FROM ${PARENT_IMAGE} AS prod
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Assign labels
LABEL org.opencontainers.image.title=yearbook
LABEL org.opencontainers.image.description="Docker container for managing a yearbook"
LABEL org.opencontainers.image.documentation="https://github.com/knicholson32/yearbook"
LABEL org.opencontainers.image.authors="Keenan Nicholson"
LABEL org.opencontainers.image.source="https://github.com/knicholson32/yearbook"

# Renew args from above
ARG NODE_VERSION
ARG PARENT_IMAGE
ARG USR_LOCAL_EXPORT
ARG ROOT_EXPORT
ARG WHEEL_EXPORT
ARG SERVER_PORT

# Set environmental variables
ENV PORT=${SERVER_PORT}
# No `?connection_limit=1` here. The Prisma CLI understands query parameters on a SQLite
# URL, but the runtime goes through @prisma/adapter-better-sqlite3, which hands the string
# to better-sqlite3 as a plain filename -- so the server quietly opened, and created, a file
# called `yearbook.db?connection_limit=1` while `migrate deploy` migrated the real one. The
# app then started against an empty database. The setting is meaningless for better-sqlite3
# anyway: it is synchronous and single-process.
ENV DATABASE_URL="file:/db/yearbook.db"
# Photos and exports live on a mounted volume, not inside the image. Both compose files
# mount ../library/files here; override FILES_FOLDER to put it elsewhere.
ENV FILES_FOLDER="/files"
ENV ORIGIN="http://localhost:${SERVER_PORT}"
# 11MB Max body size (for image uploads)
ENV BODY_SIZE_LIMIT=11000000
ENV PROC_SHELL='/bin/sh'
# Marks this as the shipped image. `$lib/server/auth` refuses to fall back to trusting the
# `cf-access-authenticated-user-email` header when it is set, so a tunnel pointed at a
# hostname with no Access policy fails closed instead of accepting a self-declared identity.
ENV YEARBOOK_PACKAGED=1

WORKDIR /app

# pnpm-workspace.yaml carries onlyBuiltDependencies (better-sqlite3, sharp, prisma);
# without it those native postinstall scripts are skipped and the runtime image is broken.
COPY --from=build "/app/package.json" "/app/package.json"
COPY --from=build "/app/pnpm-lock.yaml" "/app/pnpm-lock.yaml"
COPY --from=build "/app/pnpm-workspace.yaml" "/app/pnpm-workspace.yaml"
COPY --from=build "/app/.npmrc" "/app/.npmrc"
COPY --from=build "/app/prisma/" "/app/prisma"
COPY --from=build "/app/prisma.config.ts" "/app/prisma.config.ts"

# Fetch production dependencies into the store, then install them offline
RUN pnpm fetch --prod

# Install production node dependencies
RUN echo "---- Install Production Dependencies ----" \
  && pnpm i --prod --offline && pnpm list && pnpm exec prisma generate

COPY --from=build "/app/build/" "/app/"

ARG GIT_COMMIT
ARG GIT_REF
ARG GIT_REF_PROTECTED
ARG REGISTRY_IMAGE
ARG CI

ENV GIT_COMMIT=$GIT_COMMIT
ENV GIT_REF=$GIT_REF
ENV GIT_REF_PROTECTED=$GIT_REF_PROTECTED
ENV REGISTRY_IMAGE=$REGISTRY_IMAGE
ENV CI=$CI
ENV NODE_VERSION=${NODE_VERSION}
ENV PARENT_IMAGE=${PARENT_IMAGE}

ARG BUILD_TIMESTAMP
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP

STOPSIGNAL SIGKILL
# Set Docker command entry point and expose the proper port
EXPOSE ${SERVER_PORT}/tcp
CMD ["sh","-c","cd /app && pnpm exec prisma migrate deploy && PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host /usr/local/bin/node /app"]
