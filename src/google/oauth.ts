import type { PayloadRequest } from 'payload'

import { OAuth2Client } from 'google-auth-library'

import type { GooglePhotosPluginOptions } from '../types.js'

import { EMAIL_SCOPE, PICKER_SCOPE, PICKER_SCOPE_MISSING_MESSAGE } from '../constants.js'

export type ResolvedGoogleConfig = {
  clientId: string
  clientSecret: string
  encryptionKey: string
  redirectUri: string
}

export function inferOrigin(req: PayloadRequest): string {
  const configured = req.payload.config.serverURL
  if (configured) {
    return configured.replace(/\/$/, '')
  }

  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

export function resolveGoogleConfig(
  options: GooglePhotosPluginOptions,
  req: PayloadRequest,
): ResolvedGoogleConfig {
  const serverURL = inferOrigin(req)
  const apiRoute = req.payload.config.routes?.api || '/api'

  return {
    clientId: options.clientId || process.env.GOOGLE_PHOTOS_CLIENT_ID || '',
    clientSecret: options.clientSecret || process.env.GOOGLE_PHOTOS_CLIENT_SECRET || '',
    encryptionKey:
      options.encryptionKey || process.env.GOOGLE_PHOTOS_ENCRYPTION_KEY || req.payload.secret,
    redirectUri:
      options.redirectUri ||
      process.env.GOOGLE_PHOTOS_REDIRECT_URI ||
      `${serverURL}${apiRoute}/google-photos/oauth/callback`,
  }
}

export function createOAuthClient(config: ResolvedGoogleConfig): OAuth2Client {
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri)
}

export function hasPickerScope(scope?: null | string): boolean {
  if (!scope) {
    return false
  }
  return scope.split(/[,\s]+/).includes(PICKER_SCOPE)
}

export async function resolveGrantedScope(accessToken: string): Promise<string> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  )
  const data = (await response.json()) as { error?: string; scope?: string }
  if (hasPickerScope(data.scope) && data.scope) {
    return data.scope
  }

  throw new Error(PICKER_SCOPE_MISSING_MESSAGE)
}

export function getAuthorizationUrl(client: OAuth2Client, state: string): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: `${PICKER_SCOPE} ${EMAIL_SCOPE}`,
    state,
  })
}

export async function getGoogleEmail(client: OAuth2Client): Promise<string | undefined> {
  const response = await client.request<{ email?: string }>({
    url: 'https://www.googleapis.com/oauth2/v2/userinfo',
  })
  return response.data.email
}
