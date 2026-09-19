import type { CollectionSlug, Config, Plugin } from 'payload'

import type { GooglePhotosPluginOptions } from './types.js'

import { getOAuthCollection } from './collections/oauth.js'
import { injectUploadCollection, injectUploadCollectionSchemaOnly } from './collections/upload.js'
import { OAUTH_COLLECTION_SLUG } from './constants.js'
import { createPluginEndpoints } from './endpoints/index.js'
import { isTargetUploadCollection } from './fields/required.js'

export { OAUTH_COLLECTION_SLUG, PLUGIN_PACKAGE_NAME } from './constants.js'
export { analyzeRequiredFields, buildImportData, isTargetUploadCollection } from './fields/required.js'
export { decryptSecret, encryptSecret } from './google/crypto.js'
export type { BlockedField, GooglePhotosPluginOptions, PickedMediaItem, PromptField } from './types.js'

export const googlePhotosPlugin =
  (pluginOptions: GooglePhotosPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    const config: Config = { ...incomingConfig }
    config.collections = [...(incomingConfig.collections || [])]

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const usersSlug = (config.admin?.user || 'users') as CollectionSlug
    const alreadyHasOAuth = config.collections.some(
      (collection) => collection.slug === OAUTH_COLLECTION_SLUG,
    )
    if (!alreadyHasOAuth) {
      config.collections.push(getOAuthCollection(usersSlug))
    }

    const uploadSlugs: string[] = []
    config.collections = config.collections.map((collection) => {
      if (!isTargetUploadCollection(collection, pluginOptions.collections, OAUTH_COLLECTION_SLUG)) {
        return collection
      }

      uploadSlugs.push(collection.slug)
      if (pluginOptions.disabled) {
        return injectUploadCollectionSchemaOnly(collection)
      }
      return injectUploadCollection(collection)
    })

    if (pluginOptions.disabled) {
      return config
    }

    config.endpoints = [
      ...(config.endpoints || []),
      ...createPluginEndpoints({
        options: pluginOptions,
        uploadSlugs,
      }),
    ]

    return config
  }
