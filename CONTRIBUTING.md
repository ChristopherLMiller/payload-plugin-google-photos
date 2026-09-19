# Contributing

## Development

This repo is a Payload plugin (`src/`) plus a sample app (`dev/`).

Package `exports` point at compiled `dist/` (not `src/`). `npm publish` does not rewrite those fields from `publishConfig`, so the published tarball must already list `dist`. Local `dev/` still typechecks against `src/` via `dev/tsconfig.json` paths. Run `pnpm build` before generating the import map or running the sample app so Node can resolve the package.

```bash
cp dev/.env.example dev/.env
# set DATABASE_URL to a local MongoDB instance
# set GOOGLE_PHOTOS_CLIENT_ID / GOOGLE_PHOTOS_CLIENT_SECRET
pnpm install
pnpm build
pnpm dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin) and sign in with:

- Email: `dev@payloadcms.com`
- Password: `test`

The `media`, `gallery`, and `portraits` collections all have **Import from Google Photos** in the list view.

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

## Releases

Merges to `main` run GitHub Actions, then [semantic-release](https://github.com/semantic-release/semantic-release). Conventional Commits drive the version as described above. If there are no releasable commits, nothing is published.

### GitHub secrets

| Secret | Required for | Notes |
| --- | --- | --- |
| `NPM_TOKEN` | `npm publish` | Create an npm **automation** token (npmjs.com → Access Tokens) and add it at GitHub → Settings → Secrets and variables → Actions. Without it, CI still runs; publish is skipped. |
| `GITHUB_TOKEN` | GitHub Release + changelog commit | Built in. Grant the workflow `contents: write` (already set in `.github/workflows/ci.yml`). |

### Branch protection

On `main`, require the status check **`CI / ci`** (lint, typecheck, `pnpm test:int`, `pnpm build`) so failing PRs cannot merge. If you also require pull requests before merging, allow GitHub Actions to push release commits (`chore(release): …`) or semantic-release cannot update `CHANGELOG.md` / `package.json` on `main`.
