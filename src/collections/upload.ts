import type { CollectionConfig } from 'payload'

import {
  GOOGLE_PHOTOS_FILENAME_FIELD,
  GOOGLE_PHOTOS_ID_FIELD,
  PLUGIN_PACKAGE_NAME,
} from '../constants.js'

function hasField(collection: CollectionConfig, name: string): boolean {
  return collection.fields.some((field) => 'name' in field && field.name === name)
}

function injectHiddenFields(collection: CollectionConfig): void {
  if (!hasField(collection, GOOGLE_PHOTOS_ID_FIELD)) {
    collection.fields.push({
      name: GOOGLE_PHOTOS_ID_FIELD,
      type: 'text',
      admin: {
        hidden: true,
        readOnly: true,
      },
      index: true,
    })
  }

  if (!hasField(collection, GOOGLE_PHOTOS_FILENAME_FIELD)) {
    collection.fields.push({
      name: GOOGLE_PHOTOS_FILENAME_FIELD,
      type: 'text',
      admin: {
        hidden: true,
        readOnly: true,
      },
    })
  }
}

export function injectUploadCollection(collection: CollectionConfig): CollectionConfig {
  injectHiddenFields(collection)

  const listView =
    typeof collection.admin?.components?.views?.list === 'object'
      ? collection.admin.components.views.list
      : {}

  collection.admin = {
    ...collection.admin,
    components: {
      ...collection.admin?.components,
      views: {
        ...collection.admin?.components?.views,
        list: {
          ...listView,
          actions: [
            ...((listView.actions) || []),
            {
              clientProps: {
                collectionSlug: collection.slug,
              },
              path: `${PLUGIN_PACKAGE_NAME}/client#ImportFromGooglePhotos`,
            },
          ],
        },
      },
    },
  }

  return collection
}

export function injectUploadCollectionSchemaOnly(collection: CollectionConfig): CollectionConfig {
  injectHiddenFields(collection)
  return collection
}
