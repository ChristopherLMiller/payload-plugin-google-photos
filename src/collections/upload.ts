import type { CollectionConfig } from 'payload'

import { PLUGIN_PACKAGE_NAME } from '../constants.js'

export function injectUploadCollection(collection: CollectionConfig): CollectionConfig {
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
            ...(listView.actions || []),
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
