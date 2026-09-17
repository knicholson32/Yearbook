.PHONY: all test clean

# node_modules is never deleted here: .dockerignore already keeps the host's
# darwin-arm64 tree out of the build context, and the dev/preview containers
# install into their own named volume. The host copy exists for the editor's
# language server -- wiping it just breaks intellisense until the next
# `pnpm install`.

create-local:
	docker build --file ./docker/Dockerfile --build-arg GIT_COMMIT=$(shell git rev-parse HEAD) --build-arg BUILD_TIMESTAMP=$(shell date +%s) --target prod -t keenanrnicholson/yearbook:local .
create-all:
	docker buildx build --builder mybuilder --file ./docker/Dockerfile --push --build-arg GIT_COMMIT=$(shell git rev-parse HEAD) --target prod --platform linux/arm64,linux/amd64 --tag keenanrnicholson/yearbook:latest .
dev:
	docker build --build-arg GIT_COMMIT=$(shell git rev-parse HEAD) --platform linux/arm64 --file ./docker/Dockerfile --target dev -t yearbook-dev .
	docker compose -f ./docker/docker-compose.dev.yml -p yearbook up --remove-orphans
preview:
	docker build --build-arg GIT_COMMIT=$(shell git rev-parse HEAD) --platform linux/amd64 --file ./docker/Dockerfile --target dev -t yearbook-dev .
	docker compose -f ./docker/docker-compose.preview.yml -p yearbook up --remove-orphans
local:
	docker compose -f ./docker/docker-compose.local.yml up --remove-orphans