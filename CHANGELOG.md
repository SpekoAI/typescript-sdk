# Changelog

All notable changes to `@spekoai/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-04-26

### Added

- `RoutingIntent.region` — optional string forwarded to the gateway as
  `intent.region`. Set when latency to a specific geography matters
  (e.g. `'us-east4'`, `'eu-west1'`); STT/TTS rankings differ per
  region. Omitting it preserves the previous behaviour: the server
  defaults to `'global'`, which surfaces the region-agnostic (batch)
  benchmark rows. Plumbed through `transcribe()`, `synthesize()`, and
  `complete({ intent })`.

## [0.2.0] - 2026-04-26

### Removed

- **BREAKING**: `RoutingIntent.vertical` removed (and the `Vertical`
  union type along with it). The router now ranks on
  `(language, optimizeFor)` only. Callers passing `vertical` will fail
  to type-check; the gateway also rejects the field. Old persisted
  session pipeline configs containing `vertical` are tolerated server-
  side.

## [0.0.3] - 2026-04-13

### Fixed

- Add `typescript` + `@types/node` as devDependencies so the mirror publish build (`npm install --no-save` + `npx tsc`) resolves the real compiler instead of the squatter `tsc@2.0.4` npm package.

## [0.0.2] - 2026-04-13

### Changed

- Package scope renamed from `@speko/sdk` to `@spekoai/sdk`.

### Fixed

- Mirror publish workflow now uses trusted-publisher OIDC (Node 24 / npm 11), omits stale `registry-url`, drops deprecated `baseUrl`, and uses `--generate-notes` for GitHub releases from lightweight mirror tags.
