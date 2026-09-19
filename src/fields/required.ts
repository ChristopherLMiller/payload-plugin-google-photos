import type { CollectionConfig, Field } from 'payload'

import type { BlockedField, GooglePhotosPluginOptions, PickedMediaItem, PromptField } from '../types.js'

import {
  AUTO_FILL_TEXT_FIELDS,
  BLOCKED_FIELD_TYPES,
  GOOGLE_PHOTOS_FILENAME_FIELD,
  GOOGLE_PHOTOS_ID_FIELD,
  SIMPLE_FIELD_TYPES,
  UPLOAD_MANAGED_FIELDS,
} from '../constants.js'

type NamedField = { name: string; type: string } & Field

export type LeafField = {
  field: NamedField
  name: string
}

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name
}

function fieldLabel(field: NamedField, name: string): string {
  const label = 'label' in field ? field.label : undefined
  if (typeof label === 'string' && label) {
    return label
  }
  const leaf = name.split('.').pop() || name
  return leaf.charAt(0).toUpperCase() + leaf.slice(1)
}

function isNamedField(field: Field): field is NamedField {
  return 'name' in field && typeof field.name === 'string' && Boolean(field.name)
}

export function flattenLeafFields(fields: Field[], prefix = ''): LeafField[] {
  const leaves: LeafField[] = []

  for (const field of fields) {
    if (field.type === 'tabs' && 'tabs' in field) {
      for (const tab of field.tabs) {
        const tabPrefix = 'name' in tab && tab.name ? joinPath(prefix, tab.name) : prefix
        leaves.push(...flattenLeafFields(tab.fields, tabPrefix))
      }
      continue
    }

    if (
      (field.type === 'group' || field.type === 'row' || field.type === 'collapsible' || field.type === 'array') &&
      'fields' in field
    ) {
      if (field.type === 'array' && isNamedField(field)) {
        leaves.push({ name: joinPath(prefix, field.name), field })
        continue
      }

      const nextPrefix =
        field.type === 'group' && isNamedField(field) ? joinPath(prefix, field.name) : prefix
      leaves.push(...flattenLeafFields(field.fields, nextPrefix))
      continue
    }

    if (isNamedField(field)) {
      leaves.push({ name: joinPath(prefix, field.name), field })
    }
  }

  return leaves
}

export function getPathValue(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part]
    }
    return undefined
  }, data)
}

export function setPathValue(data: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = data
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    const next = current[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

function hasDefaultValue(field: NamedField): boolean {
  return 'defaultValue' in field && field.defaultValue !== undefined
}

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'boolean') {
    return value
  }
  return true
}

function normalizeSelectOptions(
  field: NamedField,
): Array<{ label: string; value: string }> | undefined {
  if (field.type !== 'select' || !('options' in field) || !field.options) {
    return undefined
  }

  return (field.options as Array<{ label: unknown; value: string } | string>).map((option) => {
    if (typeof option === 'string') {
      return { label: option, value: option }
    }
    return {
      label: typeof option.label === 'string' ? option.label : option.value,
      value: option.value,
    }
  })
}

function toPromptType(fieldType: string): PromptField['type'] {
  if (
    fieldType === 'textarea' ||
    fieldType === 'number' ||
    fieldType === 'checkbox' ||
    fieldType === 'select' ||
    fieldType === 'date'
  ) {
    return fieldType
  }
  return 'text'
}

function skipField(name: string): boolean {
  const leaf = name.split('.').pop() || name
  return (
    UPLOAD_MANAGED_FIELDS.has(leaf) ||
    leaf === GOOGLE_PHOTOS_ID_FIELD ||
    leaf === GOOGLE_PHOTOS_FILENAME_FIELD ||
    leaf === 'id' ||
    leaf === 'createdAt' ||
    leaf === 'updatedAt'
  )
}

export function getFilenameFromItem(item?: PickedMediaItem): string {
  return item?.mediaFile?.filename || 'photo.jpg'
}

export function buildAutoFill(args: {
  extraData?: Record<string, unknown>
  filename: string
  item?: PickedMediaItem
  leaves: LeafField[]
}): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (args.extraData) {
    for (const [key, value] of Object.entries(args.extraData)) {
      setPathValue(data, key, value)
    }
  }

  if (args.item?.id) {
    setPathValue(data, GOOGLE_PHOTOS_ID_FIELD, args.item.id)
  }
  setPathValue(data, GOOGLE_PHOTOS_FILENAME_FIELD, args.filename)

  for (const { name, field } of args.leaves) {
    if (skipField(name)) {
      continue
    }

    if (
      'defaultValue' in field &&
      field.defaultValue !== undefined &&
      typeof field.defaultValue !== 'function' &&
      !isFilled(getPathValue(data, name))
    ) {
      setPathValue(data, name, field.defaultValue)
    }

    const leaf = name.split('.').pop() || name
    if (
      AUTO_FILL_TEXT_FIELDS.has(leaf) &&
      (field.type === 'text' || field.type === 'textarea' || field.type === 'email') &&
      !isFilled(getPathValue(data, name))
    ) {
      setPathValue(data, name, args.filename)
    }
  }

  return data
}

export function analyzeRequiredFields(args: {
  collectionSlug: string
  extraData?: Record<string, unknown>
  fields: Field[]
  item?: PickedMediaItem
  mapMediaData?: GooglePhotosPluginOptions['mapMediaData']
}): {
  autoFill: Record<string, unknown>
  blockedFields: BlockedField[]
  data: Record<string, unknown>
  promptFields: PromptField[]
} {
  const leaves = flattenLeafFields(args.fields)
  const filename = getFilenameFromItem(args.item)
  const autoFill = buildAutoFill({
    extraData: args.extraData,
    filename,
    item: args.item,
    leaves,
  })

  const mapped = args.mapMediaData?.({
    collectionSlug: args.collectionSlug,
    extraData: args.extraData || {},
    item: args.item || { id: 'preview', mediaFile: { filename } },
  })

  const data = {
    ...autoFill,
    ...(mapped || {}),
  }

  const promptFields: PromptField[] = []
  const blockedFields: BlockedField[] = []

  for (const { name, field } of leaves) {
    if (skipField(name)) {
      continue
    }

    const required = 'required' in field && Boolean(field.required)
    if (!required) {
      continue
    }

    if (hasDefaultValue(field) || isFilled(getPathValue(data, name))) {
      continue
    }

    const hasMany = 'hasMany' in field && Boolean(field.hasMany)
    const isSimple = SIMPLE_FIELD_TYPES.has(field.type) && !hasMany
    const isBlocked = BLOCKED_FIELD_TYPES.has(field.type) || !isSimple

    if (isBlocked) {
      blockedFields.push({
        name,
        type: field.type,
        label: fieldLabel(field, name),
      })
      continue
    }

    promptFields.push({
      name,
      type: toPromptType(field.type),
      label: fieldLabel(field, name),
      options: normalizeSelectOptions(field),
      required: true,
    })
  }

  return { autoFill, blockedFields, data, promptFields }
}

export function buildImportData(args: {
  collectionSlug: string
  extraData?: Record<string, unknown>
  fields: Field[]
  item: PickedMediaItem
  mapMediaData?: GooglePhotosPluginOptions['mapMediaData']
}): {
  blockedFields: BlockedField[]
  data: Record<string, unknown>
  promptFields: PromptField[]
} {
  const analysis = analyzeRequiredFields(args)
  return {
    blockedFields: analysis.blockedFields,
    data: analysis.data,
    promptFields: analysis.promptFields,
  }
}

export function isUploadCollection(collection: CollectionConfig): boolean {
  return Boolean(collection.upload)
}

export function isTargetUploadCollection(
  collection: CollectionConfig,
  allowlist?: string[],
  oauthSlug?: string,
): boolean {
  if (oauthSlug && collection.slug === oauthSlug) {
    return false
  }
  if (!isUploadCollection(collection)) {
    return false
  }
  if (allowlist) {
    return allowlist.includes(collection.slug)
  }
  return true
}
