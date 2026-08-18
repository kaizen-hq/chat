/**
 * tokenCipher.js — synchronous AES-256-GCM encrypt/decrypt for session tokens.
 *
 * The key is a 32-byte value derived from the SESSION_ENCRYPTION_KEY env var
 * (base64-encoded). If the env var is not set, encrypt/decrypt are no-ops and
 * the plaintext is returned unchanged (with a startup warning from context.js).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const IV_LEN  = 12  // GCM recommended nonce length
const TAG_LEN = 16  // GCM auth tag length

/**
 * Encrypt a string. Returns a base64 blob: iv(12) + tag(16) + ciphertext.
 * Returns `plaintext` unchanged if `keyBuffer` is null.
 * @param {string} plaintext
 * @param {Buffer|null} keyBuffer  32-byte key
 * @returns {string}
 */
export function encryptToken(plaintext, keyBuffer) {
  if (!keyBuffer) return plaintext
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/**
 * Decrypt a blob produced by `encryptToken`.
 * Returns `ciphertext` unchanged if `keyBuffer` is null.
 * @param {string} ciphertext
 * @param {Buffer|null} keyBuffer  32-byte key
 * @returns {string}
 */
export function decryptToken(ciphertext, keyBuffer) {
  if (!keyBuffer) return ciphertext
  try {
    const buf = Buffer.from(ciphertext, 'base64')
    const iv  = buf.subarray(0, IV_LEN)
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const enc = buf.subarray(IV_LEN + TAG_LEN)
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return ciphertext  // corrupted or not encrypted — return as-is
  }
}

/**
 * Parse SESSION_ENCRYPTION_KEY env var into a 32-byte Buffer.
 * Returns null if not set or invalid.
 */
export function loadEncryptionKey(envValue) {
  if (!envValue) return null
  try {
    const buf = Buffer.from(envValue, 'base64')
    if (buf.length !== 32) throw new Error('key must be 32 bytes')
    return buf
  } catch (e) {
    console.warn(`[tokenCipher] SESSION_ENCRYPTION_KEY is invalid: ${e.message} — tokens stored unencrypted`)
    return null
  }
}
