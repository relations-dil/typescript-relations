ACCOUNT=gaf3
IMAGE=typescript-relations
INSTALL=node:22.9.0-alpine3.20
VERSION?=$(shell cat VERSION)
DEBUG_PORT=9229
PORT?=8483
TTY=$(shell if tty -s; then echo "-it"; fi)
VOLUMES=-v ${PWD}/src:/opt/service/src \
		-v ${PWD}/test:/opt/service/test \
		-v ${PWD}/example:/opt/service/example \
		-v ${PWD}/package.json:/opt/service/package.json \
		-v ${PWD}/package-lock.json:/opt/service/package-lock.json \
		-v ${PWD}/tsconfig.json:/opt/service/tsconfig.json \
		-v ${PWD}/tsconfig.test.json:/opt/service/tsconfig.test.json \
		-v ${PWD}/eslint.config.js:/opt/service/eslint.config.js
NPM=-v ${PWD}/LICENSE:/opt/service/LICENSE \
	-v ${PWD}/README.md:/opt/service/README.md
NPMRC=$(shell test -f ${HOME}/.npmrc && echo "-v ${HOME}/.npmrc:/root/.npmrc")
# Building a package reads the source and keeps nothing, so it gets only what it uses, read-only
PACKAGE=-v ${PWD}/src:/opt/service/src:ro \
	-v ${PWD}/package.json:/opt/service/package.json:ro \
	-v ${PWD}/package-lock.json:/opt/service/package-lock.json:ro \
	-v ${PWD}/tsconfig.json:/opt/service/tsconfig.json:ro \
	-v ${PWD}/VERSION:/opt/service/VERSION:ro \
	-v ${PWD}/LICENSE:/opt/service/LICENSE:ro \
	-v ${PWD}/README.md:/opt/service/README.md:ro \
	-v ${PWD}/CHANGELOG.md:/opt/service/CHANGELOG.md:ro

.PHONY: build shell debug test lint example setup tag untag pack publish new sync version release-check release verify test-release help dotroute stop single local check-single
.DEFAULT_GOAL := help


build: ## Builds the docker image
	docker build . -t $(ACCOUNT)/$(IMAGE):$(VERSION)

shell: ## Opens a shell in the container
	docker run --rm $(TTY) $(VOLUMES) $(NPMRC) -p 127.0.0.1:$(DEBUG_PORT):9229 $(ACCOUNT)/$(IMAGE):$(VERSION) sh

debug: ## Runs the tests under the debugger on port 9229
	docker run --rm $(TTY) $(VOLUMES) -p 127.0.0.1:$(DEBUG_PORT):9229 $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "node --import tsx --inspect-brk=0.0.0.0:9229 --test test/*.test.ts"

test: ## Runs the tests with coverage
	docker run --rm $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) npm run coverage

lint: ## Runs the typecheck and eslint
	docker run --rm $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) npm run lint

example: ## Runs the examples
	docker run --rm $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) npm run example

setup: ## Checks the package installs and its modules load
	docker run --rm $(TTY) $(VOLUMES) $(NPM) $(INSTALL) sh -c "cp -r /opt/service /opt/install && cd /opt/install && \
	npm ci && npm run build && npm pack && \
	mkdir /opt/consumer && cd /opt/consumer && npm init -y >/dev/null && npm install /opt/install/relations-dil-relations-*.tgz && \
	node --input-type=module -e \"import * as r from '@relations-dil/relations'; import '@relations-dil/relations/mock'; import '@relations-dil/relations/overscore'; if (!r.Model) process.exit(1); console.log('ok', Object.keys(r).length, 'exports')\""

tag: ## Tags the version and pushes the tag
	git rev-parse -q --verify refs/tags/$(VERSION) || git tag -a $(VERSION) -m "Version $(VERSION)"
	git push origin --tags

untag: ## Removes the version's tag
	-git tag -d $(VERSION)
	git push origin ":refs/tags/$(VERSION)"

pack: ## Builds the package and lists what would be published
	docker run --rm $(TTY) $(PACKAGE) $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "cp -r /opt/service /opt/install && cd /opt/install && \
	npm version $(VERSION) --no-git-tag-version --allow-same-version >/dev/null && npm run build && npm pack --dry-run"

publish: ## Publishes the version to npm
	@test -f ${HOME}/.npmrc || (echo "no ${HOME}/.npmrc to publish with" && exit 1)
	docker run --rm $(TTY) $(PACKAGE) $(NPMRC) $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "cp -r /opt/service /opt/install && cd /opt/install && \
	npm version $(VERSION) --no-git-tag-version --allow-same-version >/dev/null && npm run build && npm publish --access public"

# Releases: make new starts one, make release-check says where it's up to and what would stop it, make release finishes it.
# V is +0.0.1 (the default), +0.1, +1 or a version outright, and B names the branch. The work is in scripts/.
V?=+0.0.1
B?=

new: ## Starts a release: next version, branch, VERSION, changelog (V=+0.0.1|+0.1|+1|x.y.z, B=name)
	@sh scripts/new.sh "$(V)" "$(B)"

sync: ## Syncs package.json and the lockfile to VERSION
	docker run --rm $(TTY) -v ${PWD}/package.json:/opt/service/package.json -v ${PWD}/package-lock.json:/opt/service/package-lock.json -w /opt/service $(INSTALL) npm version $(VERSION) --no-git-tag-version --allow-same-version

version: ## Sets VERSION and syncs the package files (V=+0.0.1|+0.1|+1|x.y.z)
	@sh scripts/version.sh write "$(V)"

release-check: ## Says where the release is up to and what would stop it
	@sh scripts/release-check.sh

release: ## Does what's left of the release: checks, npm, the tag
	@sh scripts/release.sh

verify: ## Installs the version from npm in a clean container
	@sh scripts/verify.sh

# Tests the release scripts against a throwaway repo and a fake registry, nothing real is touched
test-release: ## Tests the release scripts against a throwaway repo and a fake registry
	docker run --rm $(TTY) -v ${PWD}/scripts:/opt/scripts python:3 sh /opt/scripts/test-release.sh

help: ## Lists the targets
	@awk -F ':.*## ' '/^[a-z-]+:.*## /{printf "%-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dotroute: ## Serves the doTRoute example on http://localhost:8483 (PORT=9000 to change it)
	-@docker rm -f typescript-relations-dotroute >/dev/null 2>&1
	docker run --rm --init --name typescript-relations-dotroute $(TTY) $(VOLUMES) -e PUBLIC_PORT=$(PORT) -p 127.0.0.1:$(PORT):8080 $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "mkdir -p example/dotroute/www/vendor && cp node_modules/@unum-pillars/uikit/dist/css/uikit.min.css node_modules/@unum-pillars/uikit/dist/js/uikit.min.js node_modules/@unum-pillars/uikit/dist/js/uikit-icons.min.js example/dotroute/www/vendor/ && npx esbuild src/index.ts --bundle --format=iife --global-name=Relations --platform=browser --external:node:* --outfile=example/dotroute/www/js/relations-dil.js && node example/dotroute/serve.mjs"

stop: ## Stops the doTRoute example
	-docker rm -f typescript-relations-dotroute

single: ## Builds the example into one self-contained example/single/app.html
	docker run --rm $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) node example/single/build.mjs

local: single ## Builds the single file and opens it in your browser
	@open example/single/app.html 2>/dev/null || xdg-open example/single/app.html

check-single: single ## Runs the checks on the single file
	docker run --rm $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) node example/single/check.mjs
