import type { PickedMediaItem, PickerSession } from '../types.js'

import { PICKER_API_BASE } from '../constants.js'

type PickerError = {
  error?: { message?: string; status?: string }
}

async function pickerFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${PICKER_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  const text = await response.text()
  const data = text ? (JSON.parse(text) as PickerError & T) : ({} as PickerError & T)

  if (!response.ok) {
    const message = data.error?.message || `Google Photos Picker request failed (${response.status})`
    throw new Error(message)
  }

  return data
}

export async function createPickerSession(
  accessToken: string,
  pickingConfig?: { maxItemCount?: number },
): Promise<PickerSession> {
  return pickerFetch<PickerSession>('/sessions', accessToken, {
    body: JSON.stringify(pickingConfig ? { pickingConfig } : {}),
    method: 'POST',
  })
}

export async function getPickerSession(accessToken: string, sessionId: string): Promise<PickerSession> {
  return pickerFetch<PickerSession>(`/sessions/${encodeURIComponent(sessionId)}`, accessToken)
}

export async function deletePickerSession(accessToken: string, sessionId: string): Promise<void> {
  try {
    await pickerFetch(`/sessions/${encodeURIComponent(sessionId)}`, accessToken, {
      method: 'DELETE',
    })
  } catch {
    // Session may already be expired; import can still succeed.
  }
}

export async function listPickedMediaItems(
  accessToken: string,
  sessionId: string,
): Promise<PickedMediaItem[]> {
  const items: PickedMediaItem[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      pageSize: '100',
      sessionId,
    })
    if (pageToken) {
      params.set('pageToken', pageToken)
    }

    const page = await pickerFetch<{ mediaItems?: PickedMediaItem[]; nextPageToken?: string }>(
      `/mediaItems?${params.toString()}`,
      accessToken,
    )
    items.push(...(page.mediaItems || []))
    pageToken = page.nextPageToken
  } while (pageToken)

  return items
}

export function getDownloadUrl(item: PickedMediaItem): null | string {
  const baseUrl = item.mediaFile?.baseUrl
  if (!baseUrl) {
    return null
  }

  const isVideo = item.type === 'VIDEO' || item.mediaFile?.mimeType?.startsWith('video/')
  return `${baseUrl}=${isVideo ? 'dv' : 'd'}`
}

export function getThumbnailUrl(item: PickedMediaItem): string | undefined {
  const baseUrl = item.mediaFile?.baseUrl
  if (!baseUrl) {
    return undefined
  }
  return `${baseUrl}=w256-h256`
}

export async function downloadMediaBytes(
  item: PickedMediaItem,
  accessToken: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const url = getDownloadUrl(item)
  if (!url) {
    throw new Error('Picked item is missing a download URL')
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download media (${response.status})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const mimeType =
    item.mediaFile?.mimeType || response.headers.get('content-type') || 'application/octet-stream'
  const filename = item.mediaFile?.filename || `google-photo-${item.id}`

  return { buffer, filename, mimeType }
}
