# Changelog

All notable changes to `@spekoai/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-04-13

### Fixed

- Add `typescript` + `@types/node` as devDependencies so the mirror publish build (`npm install --no-save` + `npx tsc`) resolves the real compiler instead of the squatter `tsc@2.0.4` npm package.

## [0.0.2] - 2026-04-13

### Changed

- Package scope renamed from `@speko/sdk` to `@spekoai/sdk`.

### Fixed

- Mirror publish workflow now uses trusted-publisher OIDC (Node 24 / npm 11), omits stale `registry-url`, drops deprecated `baseUrl`, and uses `--generate-notes` for GitHub releases from lightweight mirror tags.
