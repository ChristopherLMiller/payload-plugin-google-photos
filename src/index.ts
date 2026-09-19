import type { CollectionSlug, Config, Plugin } from 'payload'

import type { GooglePhotosPluginOptions } from './types.js'

import { getImportsCollection } from './collections/imports.js'
import { getOAuthCollection } from './collections/oauth.js'
import { injectUploadCollection } from './collections/upload.js'
import { IMPORTS_COLLECTION_SLUG, OAUTH_COLLECTION_SLUG } from './constants.js'
import { ensurePluginSchema } from './db/ensureSchema.js'
import { createPluginEndpoints } from './endpoints/index.js'
import { isTargetUploadCollection } from './fields/required.js'

export { IMPORTS_COLLECTION_SLUG, OAUTH_COLLECTION_SLUG, PLUGIN_PACKAGE_NAME } from './constants.js'
export { analyzeRequiredFields, buildImportData, isTargetUploadCollection } from './fields/required.js'
export { decryptSecret, encryptSecret } from './google/crypto.js'
export type { BlockedField, GooglePhotosPluginOptions, PickedMediaItem, PromptField } from './types.js'

function ensurePluginCollections(config: Config): CollectionSlug {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const usersSlug = (config.admin?.user || 'users') as CollectionSlug
  const slugs = new Set((config.collections || []).map((collection) => collection.slug))

  if (!slugs.has(OAUTH_COLLECTION_SLUG)) {
    config.collections = [...(config.collections || []), getOAuthCollection(usersSlug)]
  }
  if (!slugs.has(IMPORTS_COLLECTION_SLUG)) {
    config.collections = [...(config.collections || []), getImportsCollection()]
  }

  return usersSlug
}

export const googlePhotosPlugin =
  (pluginOptions: GooglePhotosPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    const config: Config = { ...incomingConfig }
    config.collections = [...(incomingConfig.collections || [])]
    const usersSlug = ensurePluginCollections(config)

    const uploadSlugs: string[] = []
    config.collections = config.collections.map((collection) => {
      if (!isTargetUploadCollection(collection, pluginOptions.collections)) {
        return collection
      }

      uploadSlugs.push(collection.slug)
      if (pluginOptions.disabled) {
        return collection
      }
      return injectUploadCollection(collection)
    })

    if (pluginOptions.disabled) {
      return withPluginOnInit(config, usersSlug)
    }

    config.endpoints = [
      ...(config.endpoints || []),
      ...createPluginEndpoints({
        options: pluginOptions,
        uploadSlugs,
      }),
    ]

    return withPluginOnInit(config, usersSlug)
  }

function withPluginOnInit(config: Config, usersSlug: CollectionSlug): Config {
  const incomingOnInit = config.onInit
  config.onInit = async (payload) => {
    await ensurePluginSchema(payload, usersSlug)
    if (incomingOnInit) {
      await incomingOnInit(payload)
    }
  }
  return config
}
