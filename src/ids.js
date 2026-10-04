import crypto from 'node:crypto'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function slug(size = 10) {
  const bytes = crypto.randomBytes(size)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}

export function sessionId() {
  return crypto.randomBytes(32).toString('base64url')
}
