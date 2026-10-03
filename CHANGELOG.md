# Changelog

All notable changes to this project are recorded here, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
