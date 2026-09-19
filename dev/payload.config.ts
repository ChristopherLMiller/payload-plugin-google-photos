import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import { googlePhotosPlugin } from 'payload-plugin-google-photos'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'posts',
        fields: [
          {
            name: 'title',
            type: 'text',
          },
        ],
      },
      {
        slug: 'media',
        fields: [
          {
            name: 'alt',
            type: 'text',
            required: true,
          },
        ],
        upload: {
          staticDir: path.resolve(dirname, 'media'),
        },
      },
      {
        slug: 'gallery',
        fields: [
          {
            name: 'credit',
            type: 'text',
            required: true,
          },
        ],
        upload: {
          staticDir: path.resolve(dirname, 'gallery'),
        },
      },
      {
        slug: 'portraits',
        fields: [
          {
            name: 'photographer',
            type: 'relationship',
            relationTo: 'users',
            required: true,
          },
        ],
        upload: {
          staticDir: path.resolve(dirname, 'portraits'),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [
      googlePhotosPlugin({
        clientId: process.env.GOOGLE_PHOTOS_CLIENT_ID,
        clientSecret: process.env.GOOGLE_PHOTOS_CLIENT_SECRET,
        encryptionKey: process.env.GOOGLE_PHOTOS_ENCRYPTION_KEY,
        redirectUri: process.env.GOOGLE_PHOTOS_REDIRECT_URI,
      }),
    ],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
