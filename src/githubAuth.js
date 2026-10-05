import crypto from 'node:crypto'
import { config } from './config.js'
import { encrypt, readPayload, signPayload } from './cryptoBox.js'
import * as db from './db.js'
import * as github from './github.js'
import { decodeCookieValue } from './sessionCookie.js'
import { accountFromRequest } from './fastRoutes.js'

export function authCookie(name, value, maxAge) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (config.isProd) parts.push('Secure')
  return parts.join('; ')
}

export function githubAuthorizeUrl(nonce) {
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', config.githubClientId)
  url.searchParams.set('redirect_uri', github.callbackUrl())
  url.searchParams.set('scope', 'read:user user:email repo')
  url.searchParams.set('state', nonce)
  return url.toString()
}

export function githubStart() {
  const nonce = crypto.randomBytes(16).toString('hex')
  return {
    location: githubAuthorizeUrl(nonce),
    cookie: authCookie('kept_oauth', signPayload({ nonce, visibility: 'all', exp: Date.now() + 10 * 60 * 1000 }), 600),
  }
}

function cookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    out[part.slice(0, index).trim()] = decodeCookieValue(part.slice(index + 1).trim())
  }
  return out
}

export async function githubFinish(req) {
  const query = req.query || {}
  if (query.error) return { location: '/start?notice=denied', cookie: authCookie('kept_oauth', '', 0) }
  const payload = readPayload(cookies(req.headers.cookie).kept_oauth)
  if (!payload || payload.nonce !== query.state || payload.exp < Date.now() || !query.code) {
    return { location: '/start?notice=denied', cookie: authCookie('kept_oauth', '', 0) }
  }
  const mine = await accountFromRequest(req)
  if (!mine) return { location: '/sign-in?next=/start', cookie: authCookie('kept_oauth', '', 0) }
  const token = await github.exchangeCode(query.code)
  const profile = await github.profile(token.access_token)
  try {
    await db.connectGithub(mine, {
      ...profile,
      tokenCiphertext: encrypt(token.access_token),
      canReadPrivate: github.canReadPrivate(token.scope),
      preview: false,
    })
  } catch (error) {
    if (error.code === '23505') return { location: '/start?notice=taken', cookie: authCookie('kept_oauth', '', 0) }
    throw error
  }
  const visibility = payload.visibility === 'all' ? 'all' : 'public'
  return { location: `/studio?visibility=${visibility}`, cookie: authCookie('kept_oauth', '', 0) }
}
