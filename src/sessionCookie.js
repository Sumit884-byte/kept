import { config } from './config.js'

export function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

export function readSessionCookie(req) {
  const header = req.headers?.cookie || req.headers?.Cookie || ''
  const parts = String(Array.isArray(header) ? header.join(';') : header).split(';')
  const found = parts.map((part) => part.trim()).find((part) => part.startsWith('kept_session='))
  return found ? decodeCookieValue(found.slice('kept_session='.length)) : ''
}

export function writeSessionCookie(res, sessionId, maxAgeSeconds) {
  const parts = [
    `kept_session=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (config.isProd) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearSessionCookie(res) {
  writeSessionCookie(res, '', 0)
}
