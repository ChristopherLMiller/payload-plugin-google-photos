# Setup: Payload Google Photos plugin

This plugin imports Google Photos Picker selections into Payload 3 upload collections as **true file copies**. After import, Payload owns the bytes — disconnecting Google Photos does not break existing media.

Google retired Library API browse scopes in March 2025. This plugin does **not** render a custom Photos grid. Picking happens in Google’s picker tab.

## 1. Install in a Payload 3 project

```bash
pnpm add payload-plugin-google-photos
```

`payload` `^3` is a peer dependency. `google-auth-library` is bundled with the plugin for OAuth; Picker REST calls use `fetch`.

Register the plugin in `payload.config.ts`:

```ts
import { googlePhotosPlugin } from 'payload-plugin-google-photos'

export default buildConfig({
  // serverURL is used to build the default OAuth redirect URI
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000',
  secret: process.env.PAYLOAD_SECRET,
  plugins: [
    googlePhotosPlugin({
      // optional allowlist; default is every collection with `upload: true`
      // collections: ['media'],
      // mapMediaData: ({ item, collectionSlug, extraData }) => ({ category: 'imported' }),
    }),
  ],
})
```

The plugin:

- Adds hidden `google-photos-oauth` and `google-photos-imports` collections (tokens and import dedupe)
- Injects an **Import from Google Photos** list action into each target upload collection (admin UI only — it does **not** add columns to your media tables)
- Registers API endpoints under `{apiRoute}/google-photos/...` (Payload’s API route defaults to `/api`)

Use `disabled: true` to keep the plugin collections but skip endpoints and the admin UI (useful when generating types).

On SQL databases (Postgres / SQLite) the plugin applies its own additive schema at startup (`CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`). You do **not** add plugin migrations to the host CMS. That covers:

- `google_photos_oauth` / `google_photos_imports`
- `payload_locked_documents_rels.google_photos_oauth_id` / `google_photos_imports_id` (so Better Auth / document-lock queries do not fail)
- matching columns on `payload_preferences_rels`

MongoDB needs no extra schema step. Host `payload migrate:create` remains optional if you want Drizzle snapshots to match; it is not required for the plugin to run.

## 2. Plugin options vs environment variables

Every OAuth setting can be passed as a plugin option **or** read from the environment. Options win when both are set.

| Plugin option | Env var | Required | Default / fallback |
| --- | --- | --- | --- |
| `clientId` | `GOOGLE_PHOTOS_CLIENT_ID` | Yes | — |
| `clientSecret` | `GOOGLE_PHOTOS_CLIENT_SECRET` | Yes | — |
| `redirectUri` | `GOOGLE_PHOTOS_REDIRECT_URI` | No | `{serverURL}{apiRoute}/google-photos/oauth/callback` |
| `encryptionKey` | `GOOGLE_PHOTOS_ENCRYPTION_KEY` | No | Payload `secret` (`PAYLOAD_SECRET`) |
| `collections` | — | No | Every collection with `upload: true` |
| `mapMediaData` | — | No | Last programmatic override after auto-fill and the import form |
| `disabled` | — | No | `false` |

Local default redirect URI:

```
http://localhost:3000/api/google-photos/oauth/callback
```

That is `{serverURL}` (`http://localhost:3000`) + `{apiRoute}` (`/api`) + `/google-photos/oauth/callback`. If you change `routes.api` or `serverURL`, the auto-derived URI changes with them. Set `GOOGLE_PHOTOS_REDIRECT_URI` (and the matching Google Cloud redirect) when the default is wrong.

### Encryption key

Refresh tokens are stored AES-256-GCM encrypted. The key is resolved in this order:

1. Plugin option `encryptionKey`
2. `GOOGLE_PHOTOS_ENCRYPTION_KEY`
3. Payload `secret` (`PAYLOAD_SECRET`)

Accepted key forms:

- 32 raw bytes as **64 hex characters**
- 32 raw bytes as **base64**
- Any other string, hashed with SHA-256 to 32 bytes (this is what happens with a typical `PAYLOAD_SECRET`)

If you rotate `GOOGLE_PHOTOS_ENCRYPTION_KEY` or `PAYLOAD_SECRET` after users have connected, existing tokens cannot be decrypted. Each admin must Connect again.

**Never commit** `.env`, downloaded `client_secret_*.json`, or other Google credential files.

## 3. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project (or select an existing one).
2. Enable **Google Photos Picker API** (`photospicker.googleapis.com`):
   - APIs & Services → Library → search **Photos Picker API** → Enable
   - Direct: [Photos Picker API](https://console.cloud.google.com/apis/library/photospicker.googleapis.com)

The old Google Photos Library API browse/list scopes are gone. Do not enable Library API for this plugin; it is not used.

## 4. OAuth branding (Google Auth Platform)

In Google Cloud, open **Google Auth Platform** (also still labeled **OAuth consent screen** in some menus).

### Branding

- User type: **External** (fine for testing and for a production app that any Google user may authorize)
- App name (for example `Payload Google Photos`)
- User support email (your Google account)
- App logo, home page, and privacy policy are optional until you publish
- Developer contact email

Save.

### Audience + test users

- Publishing status: **Testing**
- Add **test users** — every Google account that should be able to Connect while the app is in Testing. Your own account must be on this list.

Apps in Testing only work for listed test users. Anyone else sees Google’s “app is in testing” error.

### Scopes / Data Access — do not add the Picker scope while Testing

There is **one** Photos Picker scope:

```
https://www.googleapis.com/auth/photospicker.mediaitems.readonly
```

While the app is in **Testing**, do **not** add this scope on Branding or Data Access. The plugin requests it at **Connect** time (`GET {apiRoute}/google-photos/oauth/start`). Google will show the consent screen then.

Data Access is for later **publishing / verification**, when Google requires you to declare sensitive/restricted scopes for production review. Skip it until you are ready to publish.

The plugin also requests `https://www.googleapis.com/auth/userinfo.email` at Connect time so the admin UI can label the connected Google account. That is not the Photos Picker scope and is not what you declare for Picker verification.

## 5. Create an OAuth Web application client

1. Google Auth Platform → **Clients** → Create client
2. Application type: **Web application**
3. Name it (for example `Payload local`)
4. Authorized JavaScript origins (local):

   ```
   http://localhost:3000
   ```

5. Authorized redirect URIs — must match the plugin callback exactly:

   ```
   {serverURL}{apiRoute}/google-photos/oauth/callback
   ```

   Local default:

   ```
   http://localhost:3000/api/google-photos/oauth/callback
   ```

6. Create, then copy the **Client ID** and **Client secret**

Google also lets you download `client_secret_….apps.googleusercontent.com.json`. That file is a convenience dump of the same ID and secret. **Never commit it.** Put the values in env vars (or a secret manager) instead.

If the redirect URI does not match character-for-character (scheme, host, port, path), Google returns `redirect_uri_mismatch`.

## 6. Environment variables

In the Payload project (this repo’s sample app uses `dev/.env`):

```bash
GOOGLE_PHOTOS_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_PHOTOS_CLIENT_SECRET=your-client-secret
GOOGLE_PHOTOS_REDIRECT_URI=http://localhost:3000/api/google-photos/oauth/callback
# Optional. Falls back to PAYLOAD_SECRET.
# GOOGLE_PHOTOS_ENCRYPTION_KEY=
```

Restart the Payload server after changing env vars.

## 7. Run this repo’s `dev/` app

The repository is a Payload plugin with a sample app in `dev/` (MongoDB).

```bash
cp dev/.env.example dev/.env
# set DATABASE_URL to a local MongoDB instance, for example:
# DATABASE_URL=mongodb://127.0.0.1/payload-plugin-google-photos
# set PAYLOAD_SECRET to a unique string
# set GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET
pnpm install
pnpm dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin) and sign in with the seeded user:

- Email: `dev@payloadcms.com`
- Password: `test`

The `media`, `gallery`, and `portraits` collections all show **Import from Google Photos** in the list view.

Integration tests (in-memory Mongo) and the package build:

```bash
pnpm test:int
pnpm build
```

## 8. How import works

1. In an upload collection list view, open **Import from Google Photos**.
2. **Connect** sends the admin to `{apiRoute}/google-photos/oauth/start`, then Google, then `{apiRoute}/google-photos/oauth/callback`. Tokens are stored on `google-photos-oauth` for that Payload user (refresh token encrypted).
3. **Launch picker** creates a Picker session (`POST {apiRoute}/google-photos/sessions`) and opens `pickerUri/autoclose` in a **new tab**. Google forbids embedding the picker in an iframe.
4. The plugin polls `GET {apiRoute}/google-photos/sessions/:id` until `mediaItemsSet` is true.
5. Leftover required simple fields are collected **once for the whole batch**.
6. **Import** (`POST {apiRoute}/google-photos/sessions/:id/import`) downloads original bytes (`${baseUrl}=d`, or `=dv` for video) and creates documents with Payload Local API `payload.create({ collection, data, file })`.

The file lands in the destination collection’s existing storage adapter, with that collection’s `imageSizes` / Sharp thumbnails. `googlePhotosId` is a hidden dedupe key: re-importing the same Picker item skips the create.

Required-field strategy:

1. Apply field `defaultValue`s, filename-based `alt` / `title` / `caption` / `name`, and the hidden plugin fields.
2. Merge drawer `extraData`, then `mapMediaData`.
3. Prompt leftover simple fields (`text`, `textarea`, `number`, `checkbox`, `select`, `date`).
4. Block relationship, upload, blocks, array, richText, json, and similar types — give them a `defaultValue` or fill them in `mapMediaData`.

Plugin endpoints (all under `routes.api`, default `/api`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/google-photos/oauth/start` | Begin OAuth (admin session required) |
| `GET` | `/google-photos/oauth/callback` | OAuth redirect target |
| `GET` | `/google-photos/status` | Connected? + Google email |
| `POST` | `/google-photos/oauth/disconnect` | Revoke and delete stored tokens |
| `GET` | `/google-photos/collections/:slug/import-fields` | Prompt / blocked fields |
| `POST` | `/google-photos/sessions` | Create Picker session |
| `GET` | `/google-photos/sessions/:id` | Poll session + previews |
| `POST` | `/google-photos/sessions/:id/import` | Download and create uploads |

## 9. Production

- Add a second authorized redirect URI on the **same** OAuth Web client for production, for example `https://cms.example.com/api/google-photos/oauth/callback`.
- Set `serverURL` (or `GOOGLE_PHOTOS_REDIRECT_URI`) so the plugin’s callback matches that URI.
- Keep client ID/secret in the host’s secret store, not in git.
- Prefer a dedicated `GOOGLE_PHOTOS_ENCRYPTION_KEY` so rotating `PAYLOAD_SECRET` does not invalidate Google connections.
- Testing-mode apps still only work for listed test users. To let arbitrary Google users Connect, you must move the OAuth app to **Production**, declare the Picker scope under Data Access, and complete [Google’s OAuth verification](https://support.google.com/cloud/answer/9110914) for that sensitive/restricted scope. Branding, privacy policy, and a demo video are typically required.
- After verification, users who already connected do not need to reconnect unless you change the client, redirect URI, or encryption key.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Google Photos OAuth is not configured` | Missing `GOOGLE_PHOTOS_CLIENT_ID` / `GOOGLE_PHOTOS_CLIENT_SECRET` |
| `redirect_uri_mismatch` | Google client redirect URI ≠ plugin callback |
| App is in testing / access denied | Google account is not a test user |
| `invalid_scope` / consent errors after adding scopes in Data Access while Testing | Remove the Picker scope from Data Access; let Connect request it |
| `Google did not return a refresh token` | Reconnect; the plugin already uses `prompt=consent` and `access_type=offline` |
| Import blocked on a relationship / richText field | Set `defaultValue` or `mapMediaData`, or make the field optional |
| Existing imports stay after Disconnect | Expected — Payload owns the files |
