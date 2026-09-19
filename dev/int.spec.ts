import type { Field, Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { GOOGLE_PHOTOS_FILENAME_FIELD, GOOGLE_PHOTOS_ID_FIELD } from '../src/constants.js'
import { buildPluginSchemaStatements } from '../src/db/ensureSchema.js'
import { analyzeRequiredFields, isTargetUploadCollection } from '../src/fields/required.js'
import { decryptSecret, encryptSecret } from '../src/google/crypto.js'
import { PLUGIN_PACKAGE_NAME } from '../src/index.js'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

function fieldNames(fields: Field[]): string[] {
  return fields.flatMap((field) => ('name' in field && field.name ? [field.name] : []))
}

function coll(slug: string) {
  return payload.collections[slug as keyof typeof payload.collections]
}

function getListActions(collection: { admin?: { components?: { views?: { list?: { actions?: unknown[] } } } } }): unknown[] {
  return collection.admin?.components?.views?.list?.actions || []
}

describe('collection detection', () => {
  test('adds hidden plugin collections without mutating media schema', () => {
    expect(coll('google-photos-oauth')).toBeDefined()
    expect(coll('google-photos-oauth').config.admin?.hidden).toBe(true)
    expect(coll('google-photos-imports')).toBeDefined()
    expect(coll('google-photos-imports').config.admin?.hidden).toBe(true)
  })

  test('injects a list action into upload collections without extra media fields', () => {
    const media = coll('media').config
    const names = fieldNames(media.fields)

    expect(names).not.toContain(GOOGLE_PHOTOS_ID_FIELD)
    expect(names).not.toContain(GOOGLE_PHOTOS_FILENAME_FIELD)
    expect(getListActions(media)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientProps: { collectionSlug: 'media' },
          path: `${PLUGIN_PACKAGE_NAME}/client#ImportFromGooglePhotos`,
        }),
      ]),
    )
  })

  test('detects every upload collection by default', () => {
    expect(getListActions(coll('gallery').config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientProps: { collectionSlug: 'gallery' },
        }),
      ]),
    )
    expect(getListActions(coll('portraits').config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientProps: { collectionSlug: 'portraits' },
        }),
      ]),
    )
  })

  test('does not inject into non-upload collections', () => {
    const posts = coll('posts').config
    expect(fieldNames(posts.fields)).not.toContain(GOOGLE_PHOTOS_ID_FIELD)
    expect(getListActions(posts)).toHaveLength(0)
    expect(isTargetUploadCollection(posts)).toBe(false)
  })
})

describe('import mapping', () => {
  test('auto-fills common required text fields from the Google filename', () => {
    const analysis = analyzeRequiredFields({
      collectionSlug: 'media',
      fields: coll('media').config.fields,
      item: {
        id: 'photo-1',
        mediaFile: { filename: 'beach.jpg' },
      },
    })

    expect(analysis.data.alt).toBe('beach.jpg')
    expect(analysis.data[GOOGLE_PHOTOS_ID_FIELD]).toBeUndefined()
    expect(analysis.data[GOOGLE_PHOTOS_FILENAME_FIELD]).toBeUndefined()
    expect(analysis.promptFields).toHaveLength(0)
    expect(analysis.blockedFields).toHaveLength(0)
  })

  test('prompts once per batch for leftover simple required fields', () => {
    const analysis = analyzeRequiredFields({
      collectionSlug: 'gallery',
      fields: coll('gallery').config.fields,
    })

    expect(analysis.promptFields.map((field) => field.name)).toContain('credit')
    expect(analysis.blockedFields).toHaveLength(0)
  })

  test('applies extraData and mapMediaData before prompting', () => {
    const analysis = analyzeRequiredFields({
      collectionSlug: 'gallery',
      extraData: { credit: 'Staff photographer' },
      fields: coll('gallery').config.fields,
      mapMediaData: ({ extraData }) => ({
        credit: `${extraData.credit as string} / mapped`,
      }),
    })

    expect(analysis.data.credit).toBe('Staff photographer / mapped')
    expect(analysis.promptFields).toHaveLength(0)
  })

  test('blocks relationship and other complex required fields', () => {
    const analysis = analyzeRequiredFields({
      collectionSlug: 'portraits',
      fields: coll('portraits').config.fields,
    })

    expect(analysis.blockedFields.map((field) => field.name)).toContain('photographer')
    expect(analysis.promptFields).toHaveLength(0)
  })
})

describe('package exports', () => {
  test('points npm consumers at compiled dist, not TypeScript source', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      exports: Record<string, { default?: string; import?: string; types?: string }>
      main: string
      types: string
    }

    for (const entry of [pkg.exports['.'], pkg.exports['./client'], pkg.exports['./rsc']]) {
      expect(entry.import).toMatch(/^\.\/dist\//)
      expect(entry.types).toMatch(/^\.\/dist\//)
      expect(entry.default).toMatch(/^\.\/dist\//)
      expect(entry.import).not.toContain('/src/')
    }

    expect(pkg.main).toBe('./dist/index.js')
    expect(pkg.types).toBe('./dist/index.d.ts')
  })
})

describe('token encryption', () => {
  test('round-trips AES-256-GCM secrets', () => {
    const secret = 'unit-test-encryption-key'
    const encrypted = encryptSecret('refresh-token-value', secret)
    expect(encrypted).not.toContain('refresh-token-value')
    expect(decryptSecret(encrypted, secret)).toBe('refresh-token-value')
  })
})

describe('plugin SQL schema', () => {
  test('adds plugin tables and lock-rel columns without host migrations', () => {
    const statements = buildPluginSchemaStatements({
      idType: 'number',
      sqlite: false,
      usersTable: 'users',
    }).join('\n')

    expect(statements).toContain('CREATE TABLE IF NOT EXISTS "google_photos_oauth"')
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS "google_photos_imports"')
    expect(statements).toContain(
      'ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "google_photos_oauth_id"',
    )
    expect(statements).toContain(
      'ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "google_photos_imports_id"',
    )
  })
})
