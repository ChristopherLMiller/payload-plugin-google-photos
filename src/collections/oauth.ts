import type { CollectionConfig, CollectionSlug } from 'payload'

import { OAUTH_COLLECTION_SLUG } from '../constants.js'

export function getOAuthCollection(usersSlug: CollectionSlug): CollectionConfig {
  return {
    slug: OAUTH_COLLECTION_SLUG,
    access: {
      create: ({ req: { user } }) => Boolean(user),
      delete: ({ req: { user } }) =>
        user
          ? {
              user: {
                equals: user.id,
              },
            }
          : false,
      read: ({ req: { user } }) =>
        user
          ? {
              user: {
                equals: user.id,
              },
            }
          : false,
      update: ({ req: { user } }) =>
        user
          ? {
              user: {
                equals: user.id,
              },
            }
          : false,
    },
    admin: {
      hidden: true,
      useAsTitle: 'googleEmail',
    },
    fields: [
      {
        name: 'user',
        type: 'relationship',
        index: true,
        relationTo: usersSlug,
        required: true,
        unique: true,
      },
      {
        name: 'googleEmail',
        type: 'email',
      },
      {
        name: 'encryptedRefreshToken',
        type: 'textarea',
        required: true,
      },
      {
        name: 'accessToken',
        type: 'textarea',
      },
      {
        name: 'accessTokenExpiresAt',
        type: 'date',
      },
      {
        name: 'scope',
        type: 'text',
      },
    ],
    hooks: {
      beforeChange: [
        ({ data, req }) => {
          if (req.user) {
            return {
              ...data,
              user: req.user.id,
            }
          }
          return data
        },
      ],
    },
    lockDocuments: false,
    timestamps: true,
    versions: false,
  }
}
