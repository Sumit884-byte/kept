import { createClerkClient } from '@clerk/backend'
import { isHiddenPath } from './src/hiddenPath.js'

const API = (process.env.KEPT_API || '').replace(/\/$/, '')
const CLERK_FRONTEND = 'https://frontend-api.clerk.dev/'

function lightPath(pathname, method) {
  if (pathname === '/api/links') return method === 'GET'
  if (pathname === '/api/guest' && method === 'POST') return true
  return pathname === '/api/me'
    || pathname === '/api/example'
    || pathname === '/api/projects'
    || pathname === '/api/auth/github'
    || pathname === '/api/github/callback'
    || pathname === '/github/auth/callback'
}

const STATIC_EXAMPLE_SLUG = 'keptsample'

function appPath(pathname) {
  return pathname.startsWith('/api/')
    || pathname.startsWith('/github/')
    || pathname.startsWith('/r/')
    || pathname === '/sample'
    || pathname === '/example.pdf'
    || pathname === '/health'
}

function rewriteLocal(request) {
  const incoming = new URL(request.url)
  const target = new URL('/api/server', incoming.origin)
  target.searchParams.set('kept', `${incoming.pathname}${incoming.search}`)
  return new Response(null, {
    headers: { 'x-middleware-rewrite': `${target.pathname}${target.search}` },
  })
}

function rewriteExample(request, format) {
  const incoming = new URL(request.url)
  const target = new URL('/api/example', incoming.origin)
  target.searchParams.set('format', format)
  return new Response(null, {
    headers: { 'x-middleware-rewrite': `${target.pathname}${target.search}` },
  })
}

function clientIp(request) {
  return request.headers.get('x-real-ip')
    || request.headers.get('x-vercel-forwarded-for')
    || ''
}

async function proxyClerk(request) {
  const incoming = new URL(request.url)
  const rest = incoming.pathname.replace(/^\/__clerk\/?/, '')
  const target = new URL(`${rest}${incoming.search}`, CLERK_FRONTEND)
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('Clerk-Proxy-Url', `${incoming.origin}/__clerk`)
  if (process.env.CLERK_SECRET_KEY) headers.set('Clerk-Secret-Key', process.env.CLERK_SECRET_KEY)
  const ip = clientIp(request)
  if (ip) headers.set('X-Forwarded-For', ip)
  const init = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }
  const response = await fetch(target, init)
  const outgoing = new Headers()
  response.headers.forEach((value, key) => {
    if (key === 'content-encoding' || key === 'content-length' || key === 'set-cookie') return
    outgoing.set(key, value)
  })
  const location = response.headers.get('location')
  if (location) {
    try {
      const next = new URL(location, CLERK_FRONTEND)
      const proxy = `${incoming.origin}/__clerk`
      if (next.host === new URL(CLERK_FRONTEND).host) {
        outgoing.set('location', `${proxy}${next.pathname}${next.search}${next.hash}`)
      }
    } catch {
      // keep the original location
    }
  }
  for (const cookie of response.headers.getSetCookie?.() || []) {
    outgoing.append('set-cookie', cookie.replace(/;\s*Domain=[^;]*/i, ''))
  }
  return new Response(response.body, { status: response.status, headers: outgoing })
}

function publishableKey() {
  return process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || ''
}

function isDocument(request) {
  if (request.method !== 'GET') return false
  const dest = request.headers.get('sec-fetch-dest')
  if (dest === 'document' || dest === 'iframe') return true
  return !dest && (request.headers.get('accept') || '').includes('text/html')
}

async function clerkHandshake(request) {
  const secret = process.env.CLERK_SECRET_KEY
  const key = publishableKey()
  if (!secret || !key || !isDocument(request)) return null
  const url = new URL(request.url)
  if (
    url.pathname.startsWith('/__clerk')
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/github/')
    || url.pathname === '/sso-callback'
  ) {
    return null
  }
  try {
    const clerk = createClerkClient({ secretKey: secret, publishableKey: key })
    const options = key.startsWith('pk_live_') ? { proxyUrl: `${url.origin}/__clerk` } : {}
    const state = await clerk.authenticateRequest(request, options)
    if (state.status === 'handshake') {
      return { response: new Response(null, { status: 307, headers: state.headers }) }
    }
    const cookies = state.headers?.getSetCookie?.() || []
    return cookies.length ? { cookies } : null
  } catch {
    return null
  }
}

export const config = {
  matcher: [
    '/((?!.*\\.).*)',
    '/((?:.*/)?\\.(?!well-known(?:/|$)).*)',
    '/api/:path*',
    '/__clerk/:path*',
    '/example.pdf',
    '/r/:path*',
  ],
}

export default async function middleware(request) {
  const incoming = new URL(request.url)
  if (isHiddenPath(incoming.pathname)) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  if (incoming.pathname === '/v1/oauth_callback') {
    if (incoming.searchParams.get('err_code')) {
      return Response.redirect(`${incoming.origin}/sign-in?notice=google`, 302)
    }
    incoming.pathname = `/__clerk${incoming.pathname}`
    return Response.redirect(incoming, 307)
  }
  if (incoming.pathname === '/__clerk' || incoming.pathname.startsWith('/__clerk/')) {
    return proxyClerk(request)
  }
  const handshake = await clerkHandshake(request)
  if (handshake?.response) return handshake.response
  let response
  if (incoming.pathname === '/sample' && request.method === 'GET') {
    response = rewriteExample(request, 'redirect')
  } else if (incoming.pathname === `/r/${STATIC_EXAMPLE_SLUG}.pdf` && request.method === 'GET') {
    response = rewriteExample(request, 'pdf')
  } else if (incoming.pathname === `/r/${STATIC_EXAMPLE_SLUG}` && request.method === 'GET') {
    response = rewriteExample(request, 'page')
  } else if (incoming.pathname === '/example.pdf' && request.method === 'GET') {
    response = rewriteExample(request, 'pdf')
  } else if (incoming.pathname === '/api/server' || !appPath(incoming.pathname) || lightPath(incoming.pathname, request.method)) {
    response = new Response(null, { headers: { 'x-middleware-next': '1' } })
  } else if (!API) {
    response = rewriteLocal(request)
  } else {
    response = null
  }
  if (response) {
    for (const cookie of handshake?.cookies || []) response.headers.append('set-cookie', cookie)
    return response
  }
  const target = new URL(`${incoming.pathname}${incoming.search}`, API)
  const headers = new Headers(request.headers)
  headers.delete('host')
  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }
  const upstream = await fetch(target, init)
  const forwarded = new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
  for (const cookie of handshake?.cookies || []) forwarded.headers.append('set-cookie', cookie)
  return forwarded
}
