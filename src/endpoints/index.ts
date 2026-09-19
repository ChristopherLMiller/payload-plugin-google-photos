import type { Endpoint, PayloadRequest } from 'payload'

import type { GooglePhotosPluginOptions, ImportItemResult, SessionMediaPreview } from '../types.js'

import { findExistingImport, recordImport } from '../collections/imports.js'
import { analyzeRequiredFields, buildImportData, isTargetUploadCollection } from '../fields/required.js'
import { createOAuthClient, getAuthorizationUrl, getGoogleEmail, resolveGoogleConfig } from '../google/oauth.js'
import {
  cachePickedMediaItems,
  createPickerSession,
  deletePickerSession,
  downloadMediaBytes,
  downloadThumbnailBytes,
  getPickedMediaItemsCached,
  getPickerSession,
  listPickedMediaItems,
  previewThumbnailPath,
} from '../google/picker.js'
import { signValue, verifySignedValue } from '../google/signing.js'
import {
  disconnectGoogleAccount,
  findTokenDoc,
  getValidAccessToken,
  upsertUserTokens,
} from '../google/tokens.js'
import { asCollectionSlug } from '../utilities/asCollectionSlug.js'

export type PluginContext = {
  options: GooglePhotosPluginOptions
  uploadSlugs: string[]
}

type OAuthState = {
  exp: number
  returnTo: string
  userId: number | string
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function requireUser(req: PayloadRequest): null | Response {
  if (!req.user) {
    return json({ error: 'Unauthorized' }, 401)
  }
  return null
}

function encodeState(state: OAuthState, secret: string): string {
  return signValue(Buffer.from(JSON.stringify(state)).toString('base64url'), secret)
}

function decodeState(value: string, secret: string): null | OAuthState {
  const verified = verifySignedValue(value, secret)
  if (!verified) {
    return null
  }

  try {
    const parsed = JSON.parse(Buffer.from(verified, 'base64url').toString('utf8')) as OAuthState
    if (!parsed?.userId || !parsed.exp || parsed.exp < Date.now()) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function adminPath(req: PayloadRequest, path: string): string {
  const adminRoute = req.payload.config.routes?.admin || '/admin'
  const origin = req.payload.config.serverURL || ''
  const prefix = origin ? origin.replace(/\/$/, '') : ''
  return `${prefix}${adminRoute}${path}`
}

function getRouteParam(req: PayloadRequest, name: string): string {
  const fromRoute = req.routeParams?.[name]
  if (typeof fromRoute === 'string' && fromRoute) {
    return fromRoute
  }
  if (Array.isArray(fromRoute) && typeof fromRoute[0] === 'string') {
    return fromRoute[0]
  }
  return ''
}

function isAllowedCollection(ctx: PluginContext, slug: string, req: PayloadRequest): boolean {
  if (ctx.uploadSlugs.includes(slug)) {
    return true
  }

  const collection = req.payload.collections[asCollectionSlug(slug)]?.config
  return Boolean(
    collection && isTargetUploadCollection(collection, ctx.options.collections),
  )
}

export function createPluginEndpoints(ctx: PluginContext): Endpoint[] {
  return [
    {
      handler: (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        const google = resolveGoogleConfig(ctx.options, req)
        if (!google.clientId || !google.clientSecret) {
          return json(
            {
              error:
                'Google Photos OAuth is not configured. Set GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET.',
            },
            500,
          )
        }

        const returnToParam = req.searchParams.get('returnTo') || adminPath(req, '')
        const state = encodeState(
          {
            exp: Date.now() + 10 * 60 * 1000,
            returnTo: returnToParam,
            userId: req.user!.id,
          },
          google.encryptionKey,
        )

        const client = createOAuthClient(google)
        return Response.redirect(getAuthorizationUrl(client, state))
      },
      method: 'get',
      path: '/google-photos/oauth/start',
    },
    {
      handler: async (req) => {
        const google = resolveGoogleConfig(ctx.options, req)
        const fallback = adminPath(req, '')
        const errorRedirect = (message: string, returnTo?: string) => {
          const target = new URL(returnTo || fallback, inferRequestBase(req))
          target.searchParams.set('googlePhotos', 'error')
          target.searchParams.set('googlePhotosError', message)
          return Response.redirect(target.toString())
        }

        const code = req.searchParams.get('code')
        const stateParam = req.searchParams.get('state')
        if (!code || !stateParam) {
          return errorRedirect('Missing OAuth code or state')
        }

        const state = decodeState(stateParam, google.encryptionKey)
        if (!state) {
          return errorRedirect('Invalid or expired OAuth state')
        }

        if (!req.user || String(req.user.id) !== String(state.userId)) {
          return errorRedirect('You must be logged in to connect Google Photos', state.returnTo)
        }

        try {
          const client = createOAuthClient(google)
          const { tokens } = await client.getToken(code)
          client.setCredentials(tokens)
          const googleEmail = await getGoogleEmail(client)
          await upsertUserTokens({
            config: google,
            credentials: tokens,
            googleEmail,
            payload: req.payload,
            req,
            scope: tokens.scope,
          })

          const target = new URL(state.returnTo, inferRequestBase(req))
          target.searchParams.set('googlePhotos', 'connected')
          return Response.redirect(target.toString())
        } catch (error) {
          const message = error instanceof Error ? error.message : 'OAuth callback failed'
          return errorRedirect(message, state.returnTo)
        }
      },
      method: 'get',
      path: '/google-photos/oauth/callback',
    },
    {
      handler: async (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        const doc = await findTokenDoc(req.payload, req.user!.id)
        return json({
          connected: Boolean(doc?.encryptedRefreshToken),
          googleEmail: doc?.googleEmail || null,
        })
      },
      method: 'get',
      path: '/google-photos/status',
    },
    {
      handler: async (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        const google = resolveGoogleConfig(ctx.options, req)
        await disconnectGoogleAccount({
          config: google,
          payload: req.payload,
          req,
        })
        return json({ connected: false })
      },
      method: 'post',
      path: '/google-photos/oauth/disconnect',
    },
    {
      handler: (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        const slug = getRouteParam(req, 'slug')
        if (!isAllowedCollection(ctx, slug, req)) {
          return json({ error: `Collection "${slug}" is not a Google Photos import target` }, 400)
        }

        const collection = req.payload.collections[asCollectionSlug(slug)]
        if (!collection) {
          return json({ error: `Collection "${slug}" was not found` }, 404)
        }

        const analysis = analyzeRequiredFields({
          collectionSlug: slug,
          fields: collection.config.fields,
          mapMediaData: ctx.options.mapMediaData,
        })

        return json({
          blockedFields: analysis.blockedFields,
          promptFields: analysis.promptFields,
        })
      },
      method: 'get',
      path: '/google-photos/collections/:slug/import-fields',
    },
    {
      handler: async (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        try {
          const google = resolveGoogleConfig(ctx.options, req)
          const { accessToken } = await getValidAccessToken({
            config: google,
            payload: req.payload,
            req,
          })
          const session = await createPickerSession(accessToken)
          return json(session)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to create picker session'
          const status =
            message.includes('not connected') || message.includes('Photos Picker scope') ? 401 : 500
          return json({ error: message }, status)
        }
      },
      method: 'post',
      path: '/google-photos/sessions',
    },
    {
      handler: async (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        const sessionId = getRouteParam(req, 'id')
        if (!sessionId) {
          return json({ error: 'Missing session id' }, 400)
        }

        try {
          const google = resolveGoogleConfig(ctx.options, req)
          const { accessToken } = await getValidAccessToken({
            config: google,
            payload: req.payload,
            req,
          })
          const session = await getPickerSession(accessToken, sessionId)
          let mediaItems: SessionMediaPreview[] | undefined

          if (session.mediaItemsSet) {
            const items = await listPickedMediaItems(accessToken, sessionId)
            cachePickedMediaItems(`${req.user?.id}:${sessionId}`, items)
            mediaItems = items.map((item) => ({
              id: item.id,
              type: item.type,
              filename: item.mediaFile?.filename,
              mimeType: item.mediaFile?.mimeType,
              thumbnailUrl: previewThumbnailPath(sessionId, item.id),
            }))
          }

          return json({
            ...session,
            mediaItems,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to load picker session'
          return json({ error: message }, 500)
        }
      },
      method: 'get',
      path: '/google-photos/sessions/:id',
    },
    {
      handler: async (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        const sessionId = getRouteParam(req, 'id')
        const itemId = getRouteParam(req, 'itemId')
        if (!sessionId || !itemId) {
          return json({ error: 'Missing session or item id' }, 400)
        }

        try {
          const google = resolveGoogleConfig(ctx.options, req)
          const { accessToken } = await getValidAccessToken({
            config: google,
            payload: req.payload,
            req,
          })
          const items = await getPickedMediaItemsCached(
            accessToken,
            sessionId,
            `${req.user?.id}:${sessionId}`,
          )
          const item = items.find((mediaItem) => mediaItem.id === itemId)
          if (!item) {
            return json({ error: 'Picked item was not found in this session' }, 404)
          }

          const { buffer, mimeType } = await downloadThumbnailBytes(item, accessToken)
          return new Response(new Uint8Array(buffer), {
            headers: {
              'Cache-Control': 'private, max-age=60',
              'Content-Type': mimeType,
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to load thumbnail'
          return json({ error: message }, 500)
        }
      },
      method: 'get',
      path: '/google-photos/sessions/:id/items/:itemId/thumbnail',
    },
    {
      handler: async (req) => {
        const unauthorized = requireUser(req)
        if (unauthorized) {
          return unauthorized
        }

        const sessionId = getRouteParam(req, 'id')
        if (!sessionId) {
          return json({ error: 'Missing session id' }, 400)
        }

        const body = (await req.json?.()) as {
          collection?: string
          extraData?: Record<string, unknown>
        } | null
        const collectionSlug = body?.collection
        const extraData = body?.extraData || {}

        if (!collectionSlug || !isAllowedCollection(ctx, collectionSlug, req)) {
          return json(
            { error: `Collection "${collectionSlug || ''}" is not a Google Photos import target` },
            400,
          )
        }

        const collection = req.payload.collections[asCollectionSlug(collectionSlug)]
        if (!collection) {
          return json({ error: `Collection "${collectionSlug}" was not found` }, 404)
        }

        const preview = analyzeRequiredFields({
          collectionSlug,
          extraData,
          fields: collection.config.fields,
          mapMediaData: ctx.options.mapMediaData,
        })

        if (preview.blockedFields.length > 0 || preview.promptFields.length > 0) {
          return json(
            {
              blockedFields: preview.blockedFields,
              error: 'Required fields are missing or cannot be filled automatically',
              promptFields: preview.promptFields,
            },
            400,
          )
        }

        const google = resolveGoogleConfig(ctx.options, req)
        let accessToken: string
        try {
          ;({ accessToken } = await getValidAccessToken({
            config: google,
            payload: req.payload,
            req,
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Google Photos is not connected'
          return json({ error: message }, 401)
        }

        const items = await listPickedMediaItems(accessToken, sessionId)
        const results: ImportItemResult[] = []

        for (const item of items) {
          const filename = item.mediaFile?.filename
          try {
            const existing = await findExistingImport({
              googlePhotosId: item.id,
              payload: req.payload,
              req,
              targetCollection: collectionSlug,
            })

            if (existing) {
              results.push({
                documentId: existing.documentId,
                filename,
                googlePhotosId: item.id,
                status: 'skipped',
              })
              continue
            }

            const mapped = buildImportData({
              collectionSlug,
              extraData,
              fields: collection.config.fields,
              item,
              mapMediaData: ctx.options.mapMediaData,
            })

            if (mapped.blockedFields.length > 0 || mapped.promptFields.length > 0) {
              results.push({
                error: `Missing required fields: ${[...mapped.promptFields, ...mapped.blockedFields]
                  .map((field) => field.name)
                  .join(', ')}`,
                filename,
                googlePhotosId: item.id,
                status: 'failed',
              })
              continue
            }

            const downloaded = await downloadMediaBytes(item, accessToken)
            const created = await req.payload.create({
              collection: asCollectionSlug(collectionSlug),
              data: mapped.data as never,
              file: {
                name: downloaded.filename,
                data: downloaded.buffer,
                mimetype: downloaded.mimeType,
                size: downloaded.buffer.length,
              },
              overrideAccess: false,
              user: req.user,
            })

            await recordImport({
              documentId: created.id,
              filename: downloaded.filename,
              googlePhotosId: item.id,
              payload: req.payload,
              req,
              targetCollection: collectionSlug,
            })

            results.push({
              documentId: created.id,
              filename: downloaded.filename,
              googlePhotosId: item.id,
              status: 'imported',
            })
          } catch (error) {
            results.push({
              error: error instanceof Error ? error.message : 'Import failed',
              filename,
              googlePhotosId: item.id,
              status: 'failed',
            })
          }
        }

        await deletePickerSession(accessToken, sessionId)

        return json({ results })
      },
      method: 'post',
      path: '/google-photos/sessions/:id/import',
    },
  ]
}

function inferRequestBase(req: PayloadRequest): string {
  const configured = req.payload.config.serverURL
  if (configured) {
    return configured
  }
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}
