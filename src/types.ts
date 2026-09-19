export type PickedMediaFile = {
  baseUrl?: string
  filename?: string
  mediaFileMetadata?: {
    height?: number
    width?: number
  }
  mimeType?: string
}

export type PickedMediaItem = {
  createTime?: string
  id: string
  mediaFile?: PickedMediaFile
  type?: string
}

export type PromptField = {
  label: string
  name: string
  options?: Array<{ label: string; value: string }>
  required: boolean
  type: 'checkbox' | 'date' | 'number' | 'select' | 'text' | 'textarea'
}

export type BlockedField = {
  label: string
  name: string
  type: string
}

export type GooglePhotosPluginOptions = {
  /**
   * Google OAuth client ID. Falls back to `GOOGLE_PHOTOS_CLIENT_ID`.
   */
  clientId?: string
  /**
   * Google OAuth client secret. Falls back to `GOOGLE_PHOTOS_CLIENT_SECRET`.
   */
  clientSecret?: string
  /**
   * Optional allowlist of upload collection slugs. Default: every upload collection.
   */
  collections?: string[]
  /**
   * When true, skip endpoints and admin UI. Schema additions stay in place.
   */
  disabled?: boolean
  /**
   * AES-256-GCM key for refresh tokens. Falls back to `GOOGLE_PHOTOS_ENCRYPTION_KEY`,
   * then the Payload secret.
   */
  encryptionKey?: string
  /**
   * Last programmatic override after auto-fill and the import form.
   */
  mapMediaData?: (args: {
    collectionSlug: string
    extraData: Record<string, unknown>
    item: PickedMediaItem
  }) => Record<string, unknown> | void
  /**
   * OAuth redirect URI. Defaults to `${serverURL}${routes.api}/google-photos/oauth/callback`.
   */
  redirectUri?: string
}

export type PickerPollingConfig = {
  pollInterval?: string
  timeoutIn?: string
}

export type PickerSession = {
  expireTime?: string
  id: string
  mediaItemsSet?: boolean
  pickerUri?: string
  pollingConfig?: PickerPollingConfig
}

export type SessionMediaPreview = {
  filename?: string
  id: string
  mimeType?: string
  thumbnailUrl?: string
  type?: string
}

export type ImportItemResult = {
  documentId?: number | string
  error?: string
  filename?: string
  googlePhotosId: string
  status: 'failed' | 'imported' | 'skipped'
}
