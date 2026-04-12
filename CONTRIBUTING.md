# Contributing to `@spekoai/sdk`

Thanks for your interest in contributing! PRs and issues are welcome on this
repository.

## How contributions flow

`SpekoAI/typescript-sdk` is a public mirror of a package that lives inside an
internal SpekoAI monorepo. When a PR is merged here, an automated workflow
opens a follow-up PR in the monorepo to import the change; once that merges,
the SDK's next release includes it.

This means:

- File issues and PRs on this repo — they're seen.
- `main` is force-updated from the monorepo on every sync, so don't rely on
  long-lived branches off `main`. Rebase before every push.
- Releases are cut from the monorepo and pushed here as tags (`v*`), which
  trigger the automated npm publish.

## Local development

```bash
git clone https://github.com/SpekoAI/typescript-sdk.git
cd typescript-sdk
npm install
npx tsc -p tsconfig.publish.json
```

## Style

- Write conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`).
- Prefer small, focused PRs.
- Add tests for new behavior.
