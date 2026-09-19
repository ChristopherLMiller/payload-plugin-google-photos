# Payload Google Photos Plugin

Import photos from Google Photos into Payload CMS 3 as **true file copies**. Admins connect their own Google account, pick media with the official [Google Photos Picker API](https://developers.google.com/photos/picker/guides/get-started-picker), and the plugin downloads original bytes into whatever upload collections already exist in the host project.

Google’s Library API browse scopes were removed in March 2025. This plugin does **not** render a custom Photos grid. Picking happens in Google’s picker tab (`pickerUri` + `/autoclose`). After import, Payload owns the file — disconnecting Google Photos does not break existing media.

**Full Google Cloud + OAuth + env setup:** [docs/setup.md](docs/setup.md)

## Features

- Per-admin-user OAuth, with refresh tokens encrypted at rest (AES-256-GCM)
- Dynamic upload-collection detection (no required allowlist)
- Hidden `googlePhotosId` for dedupe on re-import
- Required-field handling: auto-fill safe values, prompt leftover simple fields once per batch, block relationship/blocks/richText/etc.
- Package exports: `.`, `./client`, `./rsc`

## Install

```bash
pnpm add payload-plugin-google-photos
```

`payload` `^3` is a peer dependency.

```ts
import { googlePhotosPlugin } from 'payload-plugin-google-photos'

export default buildConfig({
  plugins: [
    googlePhotosPlugin({
      // optional allowlist; default is every collection with `upload: true`
      // collections: ['media'],
      // mapMediaData: ({ item, collectionSlug, extraData }) => ({ category: 'imported' }),
    }),
  ],
})
```

Options can also be set with env vars:

| Option | Env var | Notes |
| --- | --- | --- |
| `clientId` | `GOOGLE_PHOTOS_CLIENT_ID` | Required |
| `clientSecret` | `GOOGLE_PHOTOS_CLIENT_SECRET` | Required |
| `redirectUri` | `GOOGLE_PHOTOS_REDIRECT_URI` | Default `${serverURL}${routes.api}/google-photos/oauth/callback` |
| `encryptionKey` | `GOOGLE_PHOTOS_ENCRYPTION_KEY` | 32-byte key as 64 hex chars or base64. Falls back to `PAYLOAD_SECRET` |
| `collections` | — | Optional upload-collection allowlist |
| `mapMediaData` | — | Last programmatic override after auto-fill and the import form |
| `disabled` | — | Keeps schema fields, skips endpoints and admin UI |

OAuth client ID/secret belong in env, not in git. Never commit downloaded `client_secret_*.json` files.

The Photos Picker scope is `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`. The plugin requests it when an admin clicks **Connect**. While the Google Cloud app is in Testing, do **not** add that scope on Branding / Data Access. See [docs/setup.md](docs/setup.md) for branding, test users, redirect URIs, and production verification.

## Local development

This repo is a Payload plugin (`src/`) plus a sample app (`dev/`).

```bash
cp dev/.env.example dev/.env
# set DATABASE_URL to a local MongoDB instance
# set GOOGLE_PHOTOS_CLIENT_ID / GOOGLE_PHOTOS_CLIENT_SECRET
pnpm install
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

## Import behavior

1. Connect Google from the collection list action.
2. Launch the picker (new tab; Google forbids iframes).
3. The plugin polls `sessions.get` until `mediaItemsSet` is true.
4. Fill any leftover required simple fields **once for the batch**.
5. Import downloads `${baseUrl}=d` (or `=dv` for video) and creates documents with Local API `payload.create({ collection, data, file })`.

Uploads use the destination collection’s existing storage adapter, thumbnails, and `imageSizes`. `googlePhotosId` is only a hidden dedupe key.

Required-field strategy:

1. Apply field `defaultValue`s, filename-based `alt` / `title` / `caption` / `name`, and hidden plugin fields.
2. Merge drawer `extraData`, then `mapMediaData`.
3. Prompt leftover simple fields (`text`, `textarea`, `number`, `checkbox`, `select`, `date`).
4. Block relationship, upload, blocks, array, richText, json, and similar types — supply them with `defaultValue` or `mapMediaData` instead.

## Releases

Merges to `main` run GitHub Actions, then [semantic-release](https://github.com/semantic-release/semantic-release). Conventional Commits drive the version:

| Commit | Version bump |
| --- | --- |
| `feat:` | minor |
| `fix:` | patch |
| `BREAKING CHANGE:` footer or `feat!:` / `fix!:` | major |

If there are no releasable commits, nothing is published. See [CONTRIBUTING.md](CONTRIBUTING.md).

### GitHub secrets

| Secret | Required for | Notes |
| --- | --- | --- |
| `NPM_TOKEN` | `npm publish` | Create an npm **automation** token (npmjs.com → Access Tokens) and add it at GitHub → Settings → Secrets and variables → Actions. Without it, CI still runs; publish is skipped. |
| `GITHUB_TOKEN` | GitHub Release + changelog commit | Built in. Grant the workflow `contents: write` (already set in `.github/workflows/ci.yml`). |

### Branch protection

On `main`, require the status check **`CI / ci`** (lint, typecheck, `pnpm test:int`, `pnpm build`) so failing PRs cannot merge. If you also require pull requests before merging, allow GitHub Actions to push release commits (`chore(release): …`) or semantic-release cannot update `CHANGELOG.md` / `package.json` on `main`.

## License

MIT
