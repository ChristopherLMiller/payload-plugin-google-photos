# Contributing

## Development

```bash
cp dev/.env.example dev/.env
pnpm install
pnpm dev
```

Admin login for the sample app: `dev@payloadcms.com` / `test`.

```bash
pnpm lint
pnpm typecheck
pnpm test:int
pnpm build
```

`pnpm test:e2e` is an optional Playwright smoke test against a running `dev` server. CI does not run it.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). [semantic-release](https://github.com/semantic-release/semantic-release) reads them on merge to `main` and decides whether to bump the version, update `CHANGELOG.md`, create a GitHub Release, and `npm publish`.

| Prefix | Release |
| --- | --- |
| `feat:` | minor (`1.0.0` → `1.1.0`) |
| `fix:` | patch (`1.0.0` → `1.0.1`) |
| `feat:` / `fix:` / `perf:` with `BREAKING CHANGE:` in the footer, or `feat!:` / `fix!:` | major (`1.0.0` → `2.0.0`) |
| `docs:`, `chore:`, `style:`, `refactor:`, `test:`, `ci:` | no release |

Examples:

```
feat: add Google Photos Picker plugin for Payload 3

fix: refresh OAuth tokens before picker session create

feat!: require Payload 4

chore: ignore Google client_secret JSON downloads
```

A breaking change footer:

```
feat: rename plugin option collections allowlist

BREAKING CHANGE: `collections` now takes slugs only.
```

If a merge to `main` has no releasable commits, semantic-release does **not** bump, tag, or publish.

## Pull requests

PRs targeting `main` must pass the GitHub Actions workflow **CI / ci** (install, lint, typecheck, integration tests, build). Enable branch protection on `main` so that check is required.

Do not commit `.env`, `client_secret_*.json`, `node_modules`, or other credentials.
