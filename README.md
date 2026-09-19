# Payload Google Photos Plugin

Import photos from Google Photos into Payload CMS 3 as **true file copies**. Admins connect their own Google account, pick media with the official [Google Photos Picker API](https://developers.google.com/photos/picker/guides/get-started-picker), and the plugin downloads original bytes into whatever upload collections already exist in the host project.

Google’s Library API browse scopes were removed in March 2025. This plugin does **not** render a custom Photos grid. Picking happens in Google’s picker tab (`pickerUri` + `/autoclose`). After import, Payload owns the file — disconnecting Google Photos does not break existing media.

**Full Google Cloud + OAuth + env setup:** [docs/setup.md](docs/setup.md)

## Install

```bash
pnpm add payload-plugin-google-photos
```

`payload` `^3` is a peer dependency.

Until the package is on npm, install from GitHub:

```bash
pnpm add github:ChristopherLMiller/payload-plugin-google-photos#v1.0.0
```

## Usage

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

## Configuration

Options can be set on the plugin or with env vars. Options win when both are set.

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

## In the admin

Each target upload collection list view gets **Import from Google Photos**:

1. **Connect** Google from the collection list action.
2. **Launch picker** (new tab; Google forbids iframes).
3. Fill any leftover required simple fields **once for the batch**.
4. **Import** downloads original bytes (`${baseUrl}=d`, or `=dv` for video) and creates documents with Local API `payload.create({ collection, data, file })`.

Uploads use the destination collection’s existing storage adapter, thumbnails, and `imageSizes`. `googlePhotosId` is only a hidden dedupe key.

Required-field strategy:

1. Apply field `defaultValue`s, filename-based `alt` / `title` / `caption` / `name`, and hidden plugin fields.
2. Merge drawer `extraData`, then `mapMediaData`.
3. Prompt leftover simple fields (`text`, `textarea`, `number`, `checkbox`, `select`, `date`).
4. Block relationship, upload, blocks, array, richText, json, and similar types — supply them with `defaultValue` or `mapMediaData` instead.

## License

MIT
