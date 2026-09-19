import type { CollectionSlug } from 'payload'

export function asCollectionSlug(slug: string): CollectionSlug {
  // Host apps generate a CollectionSlug union; plugins must accept any slug string.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return slug as CollectionSlug
}

