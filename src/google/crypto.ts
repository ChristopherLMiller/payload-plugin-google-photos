import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export function resolveEncryptionKey(secret: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, 'hex')
  }

  try {
    const asBase64 = Buffer.from(secret, 'base64')
    if (asBase64.length === 32) {
      return asBase64
    }
  } catch {
    // fall through to hash
  }

  return createHash('sha256').update(secret).digest()
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = resolveEncryptionKey(secret)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptSecret(payload: string, secret: string): string {
  const key = resolveEncryptionKey(secret)
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
