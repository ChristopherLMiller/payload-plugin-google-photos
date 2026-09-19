import type { Credentials } from 'google-auth-library'
import type { Payload, PayloadRequest } from 'payload'

import { OAUTH_COLLECTION_SLUG } from '../constants.js'
import { asCollectionSlug } from '../utilities/asCollectionSlug.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import { createOAuthClient, type ResolvedGoogleConfig, resolveGrantedScope } from './oauth.js'

export type OAuthTokenDoc = {
  accessToken?: null | string
  accessTokenExpiresAt?: Date | null | string
  encryptedRefreshToken?: null | string
  googleEmail?: null | string
  id: number | string
  scope?: null | string
  user?: unknown
}

function getUserId(req: PayloadRequest): number | string {
  const user = req.user
  if (!user?.id) {
    throw new Error('Unauthorized')
  }
  return user.id
}

export async function findTokenDoc(
  payload: Payload,
  userId: number | string,
): Promise<null | OAuthTokenDoc> {
  const result = await payload.find({
    collection: asCollectionSlug(OAUTH_COLLECTION_SLUG),
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      user: {
        equals: userId,
      },
    },
  })

  return (result.docs[0] as OAuthTokenDoc | undefined) || null
}

function isExpired(expiresAt?: Date | null | string): boolean {
  if (!expiresAt) {
    return true
  }
  const time = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt.getTime()
  return Number.isNaN(time) || time < Date.now() + 60_000
}

export async function upsertUserTokens(args: {
  config: ResolvedGoogleConfig
  credentials: Credentials
  googleEmail?: string
  payload: Payload
  req: PayloadRequest
  scope?: string
}): Promise<OAuthTokenDoc> {
  const { config, credentials, googleEmail, payload, req, scope } = args
  const userId = getUserId(req)

  if (!credentials.refresh_token && !credentials.access_token) {
    throw new Error('Google did not return OAuth tokens')
  }

  const existing = await findTokenDoc(payload, userId)
  const refreshToken =
    credentials.refresh_token ||
    (existing?.encryptedRefreshToken
      ? decryptSecret(existing.encryptedRefreshToken, config.encryptionKey)
      : undefined)

  if (!refreshToken) {
    throw new Error('Google did not return a refresh token. Reconnect and grant offline access.')
  }

  let grantedScope = scope || credentials.scope || existing?.scope || ''
  if (credentials.access_token) {
    grantedScope = await resolveGrantedScope(credentials.access_token)
  }

  const data = {
    accessToken: credentials.access_token || existing?.accessToken || '',
    accessTokenExpiresAt: credentials.expiry_date
      ? new Date(credentials.expiry_date).toISOString()
      : new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    encryptedRefreshToken: encryptSecret(refreshToken, config.encryptionKey),
    googleEmail: googleEmail || existing?.googleEmail || '',
    scope: grantedScope,
    user: userId,
  }

  if (existing) {
    return (await payload.update({
      id: existing.id,
      collection: asCollectionSlug(OAUTH_COLLECTION_SLUG),
      data: data as never,
      overrideAccess: true,
      req,
      user: req.user,
    })) as unknown as OAuthTokenDoc
  }

  return (await payload.create({
    collection: asCollectionSlug(OAUTH_COLLECTION_SLUG),
    data: data as never,
    overrideAccess: true,
    req,
    user: req.user,
  })) as unknown as OAuthTokenDoc
}

export async function getValidAccessToken(args: {
  config: ResolvedGoogleConfig
  payload: Payload
  req: PayloadRequest
}): Promise<{ accessToken: string; doc: OAuthTokenDoc }> {
  const { config, payload, req } = args
  const userId = getUserId(req)
  const doc = await findTokenDoc(payload, userId)

  if (!doc?.encryptedRefreshToken) {
    throw new Error('Google Photos is not connected')
  }

  if (doc.accessToken && !isExpired(doc.accessTokenExpiresAt)) {
    await resolveGrantedScope(doc.accessToken)
    return { accessToken: doc.accessToken, doc }
  }

  const refreshToken = decryptSecret(doc.encryptedRefreshToken, config.encryptionKey)
  const client = createOAuthClient(config)
  client.setCredentials({ refresh_token: refreshToken })
  const refreshed = await client.refreshAccessToken()
  const updated = await upsertUserTokens({
    config,
    credentials: refreshed.credentials,
    payload,
    req,
    scope: refreshed.credentials.scope,
  })

  if (!updated.accessToken) {
    throw new Error('Failed to refresh Google access token')
  }

  return { accessToken: updated.accessToken, doc: updated }
}

export async function disconnectGoogleAccount(args: {
  config: ResolvedGoogleConfig
  payload: Payload
  req: PayloadRequest
}): Promise<void> {
  const { config, payload, req } = args
  const userId = getUserId(req)
  const doc = await findTokenDoc(payload, userId)
  if (!doc) {
    return
  }

  const client = createOAuthClient(config)
  const token =
    doc.accessToken ||
    (doc.encryptedRefreshToken
      ? decryptSecret(doc.encryptedRefreshToken, config.encryptionKey)
      : undefined)

  if (token) {
    try {
      await client.revokeToken(token)
    } catch {
      // Revoke is best-effort; still delete local tokens.
    }
  }

  await payload.delete({
    id: doc.id,
    collection: asCollectionSlug(OAUTH_COLLECTION_SLUG),
    overrideAccess: true,
    req,
    user: req.user,
  })
}
