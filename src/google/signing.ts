import { createHmac, timingSafeEqual  } from 'node:crypto'

import { resolveEncryptionKey } from './crypto.js'

export function signValue(value: string, secret: string): string {
  const key = resolveEncryptionKey(secret)
  const hmac = createHmac('sha256', key).update(value).digest('base64url')
  return `${value}.${hmac}`
}

export function verifySignedValue(signed: string, secret: string): null | string {
  const separator = signed.lastIndexOf('.')
  if (separator <= 0) {
    return null
  }

  const value = signed.slice(0, separator)
  const provided = signed.slice(separator + 1)
  const key = resolveEncryptionKey(secret)
  const expected = createHmac('sha256', key).update(value).digest('base64url')

  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length) {
    return null
  }

  return timingSafeEqual(a, b) ? value : null
}
