ACCOUNT=gaf3
IMAGE=typescript-relations
INSTALL=node:22.9.0-alpine3.20
VERSION?=0.1.0
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
NPMRC=-v ${HOME}/.npmrc:/root/.npmrc

.PHONY: stop build shell debug test lint setup tag untag pack publish example

build:
	docker build . -t $(ACCOUNT)/$(IMAGE):$(VERSION)

shell:
	docker run $(TTY) $(VOLUMES) -p 127.0.0.1:$(DEBUG_PORT):9229 $(ACCOUNT)/$(IMAGE):$(VERSION) sh

debug:
	docker run $(TTY) $(VOLUMES) -p 127.0.0.1:$(DEBUG_PORT):9229 $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "node --import tsx --inspect-brk=0.0.0.0:9229 --test test/*.test.ts"

test:
	docker run $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) npm run coverage

lint:
	docker run $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) npm run lint

example:
	docker run $(TTY) $(VOLUMES) $(ACCOUNT)/$(IMAGE):$(VERSION) npm run example

setup:
	docker run $(TTY) $(VOLUMES) $(NPM) $(INSTALL) sh -c "cp -r /opt/service /opt/install && cd /opt/install && \
	npm ci && npm run build && npm pack && \
	mkdir /opt/consumer && cd /opt/consumer && npm init -y >/dev/null && npm install /opt/install/relations-dil-relations-*.tgz && \
	node --input-type=module -e \"import * as r from '@relations-dil/relations'; import '@relations-dil/relations/mock'; import '@relations-dil/relations/overscore'; if (!r.Model) process.exit(1); console.log('ok', Object.keys(r).length, 'exports')\""

tag:
	-git tag -a $(VERSION) -m "Version $(VERSION)"
	git push origin --tags

untag:
	-git tag -d $(VERSION)
	git push origin ":refs/tags/$(VERSION)"

pack:
	docker run $(TTY) $(VOLUMES) $(NPM) $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "npm run build && npm pack --dry-run"

publish:
	@test -f ${HOME}/.npmrc || (echo "no ${HOME}/.npmrc to publish with" && exit 1)
	docker run $(TTY) $(VOLUMES) $(NPM) $(NPMRC) $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "npm run build && npm publish --access public"

.PHONY: dotroute

dotroute:
	-@docker rm -f typescript-relations-dotroute >/dev/null 2>&1
	docker run --rm --init --name typescript-relations-dotroute $(TTY) $(VOLUMES) -e PUBLIC_PORT=$(PORT) -p 127.0.0.1:$(PORT):8080 $(ACCOUNT)/$(IMAGE):$(VERSION) sh -c "mkdir -p example/dotroute/www/vendor && cp node_modules/@unum-pillars/uikit/dist/css/uikit.min.css node_modules/@unum-pillars/uikit/dist/js/uikit.min.js node_modules/@unum-pillars/uikit/dist/js/uikit-icons.min.js example/dotroute/www/vendor/ && npx --yes esbuild src/index.ts --bundle --format=iife --global-name=Relations --platform=browser --alias:node:fs/promises=./example/dotroute/stub.js --alias:node:path=./example/dotroute/stub.js --outfile=example/dotroute/www/js/relations-dil.js && node example/dotroute/serve.mjs"

stop:
	-docker rm -f typescript-relations-dotroute
