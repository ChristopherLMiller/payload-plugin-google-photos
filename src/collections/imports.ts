import type { CollectionConfig, Payload, PayloadRequest } from 'payload'

import { IMPORTS_COLLECTION_SLUG } from '../constants.js'
import { asCollectionSlug } from '../utilities/asCollectionSlug.js'

export function getImportsCollection(): CollectionConfig {
  return {
    slug: IMPORTS_COLLECTION_SLUG,
    access: {
      create: ({ req: { user } }) => Boolean(user),
      delete: ({ req: { user } }) => Boolean(user),
      read: ({ req: { user } }) => Boolean(user),
      update: ({ req: { user } }) => Boolean(user),
    },
    admin: {
      hidden: true,
      useAsTitle: 'googlePhotosId',
    },
    fields: [
      {
        name: 'googlePhotosId',
        type: 'text',
        index: true,
        required: true,
      },
      {
        name: 'targetCollection',
        type: 'text',
        index: true,
        required: true,
      },
      {
        name: 'documentId',
        type: 'text',
        required: true,
      },
      {
        name: 'filename',
        type: 'text',
      },
    ],
    indexes: [
      {
        fields: ['googlePhotosId', 'targetCollection'],
        unique: true,
      },
    ],
    timestamps: true,
  }
}

export async function findExistingImport(args: {
  googlePhotosId: string
  payload: Payload
  req?: PayloadRequest
  targetCollection: string
}): Promise<{ documentId: number | string } | null> {
  const existing = await args.payload.find({
    collection: asCollectionSlug(IMPORTS_COLLECTION_SLUG),
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req: args.req,
    where: {
      and: [
        {
          googlePhotosId: {
            equals: args.googlePhotosId,
          },
        },
        {
          targetCollection: {
            equals: args.targetCollection,
          },
        },
      ],
    },
  })

  const doc = existing.docs[0]
  if (!doc?.documentId) {
    return null
  }

  return { documentId: doc.documentId }
}

export async function recordImport(args: {
  documentId: number | string
  filename?: string
  googlePhotosId: string
  payload: Payload
  req?: PayloadRequest
  targetCollection: string
}): Promise<void> {
  await args.payload.create({
    collection: asCollectionSlug(IMPORTS_COLLECTION_SLUG),
    data: {
      documentId: String(args.documentId),
      filename: args.filename,
      googlePhotosId: args.googlePhotosId,
      targetCollection: args.targetCollection,
    },
    overrideAccess: true,
    req: args.req,
  })
}
