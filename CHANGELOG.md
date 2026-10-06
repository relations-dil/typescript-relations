# Changelog

All notable changes to this project are recorded here, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.2] - 2026-10-06

Parity with python-relations 0.6.16: an optional parent whose id is stored in a dict field of the child.

### Added
- `childInject` on `OneTo` (and so `OneToMany` and `OneToOne`): `new OneToMany(Unum, Entity, { childInject: 'what' })` adds a nullable key field to the child, `unum_id`, stored inside the child's `what` dict at `what__relations__unum__id`, so a model that's shared between apps can take on a parent without being edited or getting a column. The dict field has to be named, it isn't touched (no `extract`), and several parents can use the same one. It throws a `ModelError` if the key field already exists, the named field is missing, or it isn't a dict.
- The key is named `<model>_<id>` when the parent and child share a source, else `<parent source>_<model>_<id>` (the source lowercased, `-` as `_`), like `bucket_app_pet_id`. `childParentRef` still overrides it.
- `DNS` and `SourceError`: source names have to be dns labels (letters, digits and hyphens, 1 to 63 characters, no leading or trailing hyphen), so they're safe to use in field names. `register` throws a `SourceError` for any other name, and `OneTo` checks the parent's source when the two sources differ.

### Changed
- An empty key means no parent: `_relate` returns `null` for a parent when its key is `null`, instead of a placeholder parent that matches nothing. Setting the key later still loads the parent.
- `Record.retrieve` checks an injected field where it's stored, in the field it lives inside, so filtering by an injected key works.
- `Field.write` doesn't store a `null` for an injected field whose path is only dict keys, it leaves the key out (or removes it), since a missing key reads back as `null` and storage has no JSON nulls to trip over. Paths through a list still set the `null`.

## [0.2.1] - 2026-10-02

### Added
- The example is laid out as a list of apps: `app.js` lists them (name, title, models file, source, seed), `models/<app>.js` holds each app's models and relations (source-agnostic; the source is named for the app), and `js/unum.js` is the host that builds the apps, makes their sources, seeds an empty one and starts the screens. Screens are routed by app, `/<app>/<model>` (`#/example/unit`), with an app page at `/<app>`, a nav of apps with their models in dropdowns and a home page listing the apps, so two apps can each have a model of the same name; the access function addresses models as `api/<app>/<model>`, and routes, route names and controllers are keyed `<app>_<model>`. `make dotroute` loads the models file with a script tag; `make single` inlines `app.js` and every `models/*.js`.
- Single-file pages keep **every app's data** in one file next to the page: `app.html` loads `data.js` (a plain `<script src>`, which works from `file://`) on open, and **Save to data.js** (or Cmd/Ctrl-S) writes it back, in place after one pick in Chromium (File System Access API) or as a download elsewhere. `localStorage` stays the working copy, one key per app (`relations:<app>`); one revision covers the whole file and decides whether the file or the browser is newer, and the page asks when both changed. Apps in the file that aren't running here are kept on save. A chip shows saved or unsaved, and leaving with unsaved changes asks first. Code in `example/dotroute/www/js/persist.js`; `make check-single` runs 14 jsdom checks of the rules.
- `RestSource` (`@relations-dil/relations/rest`, also exported from the index): a source that uses a relations-restx API as its backend, a port of python-relations-rest. It takes `url`, and optionally `fetch`, `headers`, `credentials` and `request`, and works in the browser or in Node. Reads go as `POST /<endpoint>` with a `{"filter": ...}` body (which restx treats as a GET), since browsers can't send a body with a GET. Errors from the API throw a `ModelError` with its message.
- `test/restx-fake.ts`: an in-process relations-restx API (a `fetch` over MockSource-backed models) the `RestSource` tests run against, with no network.

## [0.2.0] - 2026-10-02

### Added
- A `VERSION` file as the one place the version is set. The Makefile reads it, and `make version`, `make pack` and `make publish` sync `package.json` and the lockfile to it, so what's published always matches.
- `LocalSource` (`@relations-dil/relations/local`, also exported from the index): a source that keeps its data in `localStorage` (or any `storage` you pass), loading when it's made and saving after every successful write. `MockSource` stays purely in memory.
- `make local`: builds the single file and opens it in your browser (`open`, or `xdg-open` where there's no `open`).
- `example/single/` and `make single`: builds the doTRoute app into one self-contained `app.html` (library, UIkit, jQuery, doT, doTRoute, templates and app all inlined) that opens from disk with no server and keeps its data in `localStorage`. The example app picks `LocalSource` when the page sets `STORAGE_KEY`, and only seeds an empty store; `DRApp.load` reads templates embedded in the page when there are any.
- `make shell` mounts `~/.npmrc` too, so npm commands run as you, but only when the file exists.

### Changed
- File access in `MockSource` and `Migrations` is loaded lazily and `node:path` is no longer used (a small `joinPath` replaces it), so the library bundles for the browser with no stub and no Node polyfills; only the file-based features need Node when called. `make dotroute` no longer needs a stub file, and `esbuild` is now a dev dependency.

## [0.1.0] - 2026-10-02

### Added
- Package metadata for npm: `repository`, `homepage` and `bugs`.
- Initial TypeScript port (usable from plain JavaScript) of python-relations (npm package `@relations-dil/relations`): Model, Field, Record, Relation, Source, Migrations, Titles, MockSource, overscore, and models-from-data.
- Docker-based workflow (`Dockerfile`, `Makefile`, `Jenkinsfile`) mirroring the Python repos: `make build|test|lint|setup|shell|debug|example|pack|publish|tag`. Nothing needs installing locally beyond Docker and make.
- `package.json` scripts (`build`, `test`, `coverage`, `lint`, `typecheck`, `example`) as the canonical commands; the Makefile wraps them, so `npm` works too for anyone with Node.
- ESLint (flat config, 140-column limit) and TypeScript typecheck as `lint`.
- Coverage tests (`test/coverage.test.ts`, `test/coverage-isolated.test.ts`) covering the edge cases and error paths the ported suites missed, bringing `make test` to 100% line, branch and function coverage. The isolated file runs in its own process so it can see `MigrationsRef` before `migrations.ts` replaces its stub.
- `example/dotroute/`: a playable doTRoute app that follows the layout of the other apps' `gui/www`: an empty `index.html`, one `.html` file per view (header, footer, home, form, fields, list, create, retrieve, update), the generic `js/relations.js` (Base and Model controllers, the same as the other apps' apart from `await`), and a small `js/service.js` for the app's routes. Every data call goes through one access function, `DRApp.rest(type, url, data)`, in `js/api.js`: `DRApp.http` is the other apps' request to a relations-restx API, and `DRApp.local` answers the same API from relations models running in the page, with the restx endpoints, request bodies, response shapes (`api/model`, `OPTIONS` fields with a parent's `options` and `titles`, list `formats` and `overflow`, `{updated}`/`{deleted}`) and status codes, including the alert on failure. Moving to a real backend is `DRApp.rest = DRApp.http` in `service.js`. Foreign keys render as a select of the parent's titles and display as the parent's title in lists. `make dotroute` bundles the library for the browser with esbuild (an IIFE exposing global `Relations`, with the `node:` file imports stubbed out) and serves it on http://localhost:8483 (`make dotroute PORT=9000` to change it; 8483 is ASCII T and S).

### Changed
- The published package no longer includes `.map` files (source maps and declaration maps): `src/` isn't shipped, so they pointed at nothing. They're still built locally.
- `example/dotroute/` uses the published `@unum-pillars/uikit` theme (UIkit 3 with the `uu-*` palette) instead of a vendored UIkit 2. It's a dev dependency, and `make dotroute` copies `dist/` into `example/dotroute/www/vendor/` (gitignored). The ported views use UIkit 3 classes (`uk-navbar-container`, `uk-input`, `uk-alert-danger`, ...), with the navbar built the UIkit 3 way (a full-width bar with a container inside it) and UIkit 3's own centered container width; the other apps' wide-container override in `relations.css` was UIkit 2 CSS and isn't carried over.
- Removed provably unreachable code found while reaching 100% coverage, with no behaviour change: the `UNDEFINE` filter in `Field.define()` (no definable attribute was ever in it), the unreachable `return 0` in `count()` in `field.ts`, a duplicated no-records check in `Model._item`, and `this._proxy ?? this` / `?.` / `?? 0` fallbacks in `model.ts` and `mock.ts` that could never fire.
- Tests run directly from `.ts` via `tsx` (no compiled `dist-test/` step).
- Repo is named `typescript-relations` (Docker image too); the npm package is `@relations-dil/relations`, under the `relations-dil` npm org.
- `files` in `package.json` references `LICENSE` (repo copy) instead of `LICENSE.txt`.

### Fixed
- Four lint violations in the ported source: a long line in `field.ts`, a `Function` type in `model.ts`, and two bare expressions in `ported-model.test.ts`.
