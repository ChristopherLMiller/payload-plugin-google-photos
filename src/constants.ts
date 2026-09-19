export const PLUGIN_PACKAGE_NAME = 'payload-plugin-google-photos'
export const OAUTH_COLLECTION_SLUG = 'google-photos-oauth'
export const IMPORTS_COLLECTION_SLUG = 'google-photos-imports'
export const GOOGLE_PHOTOS_ID_FIELD = 'googlePhotosId'
export const GOOGLE_PHOTOS_FILENAME_FIELD = 'googlePhotosFilename'
export const PLUGIN_COLLECTION_SLUGS = [OAUTH_COLLECTION_SLUG, IMPORTS_COLLECTION_SLUG] as const
export const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
export const PICKER_SCOPE_MISSING_MESSAGE =
  'Google did not grant the Photos Picker scope. In Google Cloud: enable Google Photos Picker API (not Library API), add https://www.googleapis.com/auth/photospicker.mediaitems.readonly under Google Auth Platform → Data access, add yourself as a test user, then Disconnect and Connect again. On Google’s consent screen keep Google Photos Picker checked.'
export const PICKER_API_BASE = 'https://photospicker.googleapis.com/v1'
export const UPLOAD_MANAGED_FIELDS = new Set([
  'filename',
  'filesize',
  'focalX',
  'focalY',
  'height',
  'mimeType',
  'sizes',
  'thumbnailURL',
  'url',
  'width',
])
export const AUTO_FILL_TEXT_FIELDS = new Set(['alt', 'caption', 'name', 'title'])
export const SIMPLE_FIELD_TYPES = new Set([
  'checkbox',
  'code',
  'date',
  'email',
  'number',
  'select',
  'text',
  'textarea',
])
export const BLOCKED_FIELD_TYPES = new Set([
  'array',
  'blocks',
  'join',
  'json',
  'point',
  'relationship',
  'richText',
  'upload',
])
