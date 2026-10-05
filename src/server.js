import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import express from 'express'
import { config, assertConfig } from './config.js'
import { copy } from './copy.js'
import { isProfileReadmeRepo } from './projectKinds.js'
import { encrypt, decrypt, signPayload, readPayload } from './cryptoBox.js'
import * as db from './db.js'
import * as github from './github.js'
import { GithubError, verifyGithubSignature } from './github.js'
import { applyLocalReadings, refreshLink } from './jobs.js'
import { exampleResume } from './example.js'
import { accountFromRequest, createGuestSession, endKeptSession, savePerson, signedInAccount } from './fastRoutes.js'
import { renderPdf, fileName } from './pdf.js'
import { placeForks, readableResume, withSkills, withStars } from './resume.js'
import { renderPublicPage } from './publicPage.js'
import { cleanConclusion } from './public/gemmaText.js'
import { listSampleProjects, samplePerson } from './sample.js'
import { clerkFrontendHost } from './clerkHost.js'
import { clerkClient, clerkMiddleware, getAuth } from '@clerk/express'
import { updatedLabel } from './when.js'
import { allow } from './limit.js'
import { decodeCookieValue } from './sessionCookie.js'
import { AppNotInstalled, readerTokens } from './githubApp.js'
import { accountKind } from './public/accountBinding.js'
import { startPoller, stopPoller } from './poller.js'
import crypto from 'node:crypto'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(root, 'public')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REPO = /^[\w.-]+\/[\w.-]+$/
const deliveries = new Set()
const SAMPLE_GITHUB_ID = 'preview:sample'
const STATIC_EXAMPLE_SLUG = 'keptsample'
let sampleLinkPromise = null

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function readCookies(req) {
  const out = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    out[part.slice(0, index).trim()] = decodeCookieValue(part.slice(index + 1).trim())
  }
  return out
}

function setCookie(res, name, value, maxAge) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (config.isProd) parts.push('Secure')
  res.append('Set-Cookie', parts.join('; '))
}

function clearCookie(res, name) {
  setCookie(res, name, '', 0)
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'local'
}

function sameOrigin(req) {
  const origin = req.get('origin')
  if (!origin) return true
  const allowed = new Set([
    config.publicUrl,
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
  ])
  return allowed.has(origin)
}

function clerkOn() {
  return Boolean(config.clerkPublishableKey && config.clerkSecretKey)
}

function hasGithub(account) {
  return accountKind(account).connected
}

function usesSample(account) {
  return accountKind(account).sample
}

export function isHiddenPath(pathname) {
  return /(^|\/)\.(?!well-known(\/|$))/.test(pathname || '')
}

// Keep in sync with the import in src/public/gemma.js and the ONNX runtime it pulls in.
const MODEL_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/',
].join(' ')

function contentSecurityPolicy(embeddable = false) {
  const host = clerkFrontendHost(config.clerkPublishableKey)
  const clerkSource = host ? ` https://${host}` : ''
  return [
    "default-src 'self'",
    `script-src 'self' ${MODEL_SCRIPTS} https://challenges.cloudflare.com${clerkSource} blob: 'wasm-unsafe-eval'`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    `connect-src 'self' https://api.github.com ${MODEL_SCRIPTS} https://huggingface.co https://cdn-lfs.huggingface.co https://us.aws.cdn.hf.co https://eu.aws.cdn.hf.co https://cas-bridge.xethub.hf.co https://cas-server.xethub.hf.co https://clerk-telemetry.com${clerkSource}`,
    "frame-src 'self' https://challenges.cloudflare.com",
    "img-src 'self' data:",
    "base-uri 'self'",
    "object-src 'none'",
    ...(embeddable ? [] : ["frame-ancestors 'self'"]),
  ].join('; ')
}

function primaryEmail(user) {
  const list = user?.emailAddresses || []
  const primary = list.find((item) => item.id === user.primaryEmailAddressId) || list[0]
  return primary?.emailAddress || ''
}

async function ensureClerkAccount(userId) {
  const existing = await db.getAccountByClerkId(userId)
  if (existing) return existing
  const user = await clerkClient.users.getUser(userId)
  const email = primaryEmail(user)
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || email.split('@')[0] || copy.name
  return db.upsertAccount({
    githubId: `clerk:${userId}`,
    clerkUserId: userId,
    login: (email.split('@')[0] || 'kept').slice(0, 80),
    name,
    email,
    avatarUrl: user.imageUrl || '',
    bio: '',
    blog: '',
    location: '',
    tokenCiphertext: encrypt('pending'),
    canReadPrivate: false,
    preview: false,
  })
}

async function accountFrom(req) {
  if (clerkOn()) {
    try {
      const account = await signedInAccount(req)
      if (account) return account
    } catch (error) {
      console.error('sign-in lookup failed', error.message)
    }
  }
  const session = await db.getSession(readCookies(req).kept_session)
  if (!session) return null
  return db.getAccount(session.account_id)
}

async function requireAccount(req) {
  const account = await accountFrom(req)
  if (!account) throw new HttpError(401, copy.errors.signedOut)
  return account
}

function presentAccount(account) {
  return {
    name: github.profileName(account.name, account.login),
    login: account.login,
    email: account.email || '',
    location: account.location || '',
    headline: account.headline,
    bio: account.bio || '',
    canReadPrivate: account.can_read_private,
    preview: usesSample(account),
    githubConnected: hasGithub(account),
    clerk: Boolean(account.clerk_user_id),
  }
}

async function dressResume(link, projects) {
  const account = link.account_id ? await db.getAccount(link.account_id) : null
  return withSkills(withStars(placeForks(readableResume(link.resume), projects), projects), projects, {
    roleTarget: link.role_target || '',
    instructions: link.instructions || '',
    profileText: account?.profile_readme || '',
    education: link.education || '',
    experience: link.experience || '',
  })
}

async function shownResume(link) {
  if (!link?.resume) return null
  const projects = link.id ? await db.loadContext(link) : []
  const resume = await dressResume(link, projects)
  if (!resume || !link.slug) return resume
  return { ...resume, liveUrl: `${config.publicUrl}/r/${link.slug}.pdf` }
}

async function presentLink(link) {
  const latest = link.id ? await db.latestReason(link.id) : null
  const trendNotes = link.id && link.resume ? await db.trendNotes(link.id) : []
  const projects = link.id ? await db.loadContext(link) : []
  return {
    id: link.id,
    slug: link.slug,
    visibility: link.visibility,
    displayName: link.display_name || '',
    headline: link.headline || '',
    email: link.email || '',
    location: link.location || '',
    education: link.education || '',
    experience: link.experience || '',
    roleTarget: link.role_target || '',
    instructions: link.instructions || '',
    selectedRepos: link.selected_repos || [],
    status: link.status,
    lastError: link.last_error || '',
    refreshedLabel: link.last_refreshed_at ? updatedLabel(link.last_refreshed_at) : '',
    reason: latest?.reason || '',
    trendNotes,
    localReads: projects
      .filter((project) => project.needsLocal || (project.reader === 'gemma' && !cleanConclusion(project.conclusion, project.name)))
      .map((project) => ({
        fullName: project.fullName,
        name: project.name,
        description: project.description || '',
        filePaths: project.filePaths || [],
      })),
    pdfUrl: `${config.publicUrl}/r/${link.slug}.pdf`,
    pageUrl: `${config.publicUrl}/r/${link.slug}`,
    resume: link.resume ? await dressResume(link, projects) : null,
  }
}

function cleanLocalReadings(body) {
  const list = Array.isArray(body.readings) ? body.readings : null
  if (!list || !list.length || list.length > 8) throw new HttpError(400, copy.errors.privateUnread)
  return list.map((item) => {
    const fullName = String(item?.fullName || '')
    if (!REPO.test(fullName)) throw new HttpError(400, copy.errors.notOnList)
    const conclusion = String(item?.conclusion || '').replace(/\s+/g, ' ').trim()
    if (conclusion.length < 12 || conclusion.length > 500) throw new HttpError(400, copy.errors.privateUnread)
    if (/app\.listen|\bfunction\s*\(|\brequire\s*\(|=>|```/.test(conclusion)) {
      throw new HttpError(400, copy.errors.privateUnread)
    }
    return { fullName, conclusion }
  })
}

function cleanFields(body) {
  const instructions = String(body.instructions || '')
  if (instructions.length > 4000) throw new HttpError(400, copy.errors.badBrief)
  const email = String(body.email || '').trim()
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+$/.test(email))) {
    throw new HttpError(400, copy.errors.email)
  }
  const visibility = body.visibility === 'all' ? 'all' : 'public'
  const repos = Array.isArray(body.repos) ? body.repos.map((repo) => String(repo)) : []
  const picked = [...new Set(repos.filter((repo) => !isProfileReadmeRepo(repo)))]
  if (!picked.length) throw new HttpError(400, copy.errors.chooseProjects)
  if (picked.some((repo) => !REPO.test(repo))) throw new HttpError(400, copy.errors.notOnList)
  return {
    visibility,
    displayName: String(body.displayName || '').trim().slice(0, 120),
    headline: String(body.headline || '').trim().slice(0, 180),
    email,
    location: String(body.location || '').trim().slice(0, 120),
    education: String(body.education || '').trim().slice(0, 1200),
    experience: String(body.experience || '').trim().slice(0, 1200),
    roleTarget: String(body.roleTarget || '').trim().slice(0, 160),
    instructions: instructions.trim(),
    repos: picked,
  }
}

async function allowedRepos(account, visibility) {
  if (!usesSample(account) && !hasGithub(account)) throw new HttpError(409, copy.errors.connectWork)
  if (usesSample(account)) {
    return listSampleProjects()
      .filter((project) => visibility === 'all' || !project.private)
      .map((project) => project.fullName)
  }
  if (visibility === 'all' && !account.can_read_private) {
    throw new HttpError(409, copy.errors.needPrivate)
  }
  const token = decrypt(account.token_ciphertext)
  const projects = await github.listRepos(token, visibility)
  return projects.map((project) => project.fullName)
}

function mapGithubError(error) {
  if (!(error instanceof GithubError)) return error
  if (error.status === 401) return new HttpError(401, copy.errors.githubAgain)
  if (error.status === 403 || error.status === 429) return new HttpError(429, copy.errors.githubLimited)
  return new HttpError(502, copy.errors.readFailed)
}

async function sendPdf(res, link, status = 200) {
  const prepared = link?.resume ? await shownResume(link) : null
  const resume = prepared || {
      name: link?.display_name || copy.name,
      summary: link ? copy.public.preparing : copy.public.missing,
      contact: [],
      work: [],
      skills: [],
    }
  const pdf = await renderPdf(resume)
  res.status(status)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${fileName(resume.name)}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.send(pdf)
}

export function buildApp() {
  const app = express()
  app.set('trust proxy', config.trustProxy)
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader(
      'Content-Security-Policy',
      contentSecurityPolicy(req.path.startsWith('/r/')),
    )
    next()
  })

  app.get('/health', wrap(async (_req, res) => {
    await db.query('SELECT 1')
    res.json({ ok: true })
  }))

  app.post('/api/github/webhook', express.raw({ type: 'application/json', limit: '1mb' }), wrap(async (req, res) => {
    const signature = req.get('x-hub-signature-256')
    if (!verifyGithubSignature(req.body, signature, config.webhookSecret)) {
      return res.status(401).end()
    }
    const event = req.get('x-github-event')
    const delivery = req.get('x-github-delivery')
    if (delivery) {
      if (deliveries.has(delivery)) return res.status(204).end()
      deliveries.add(delivery)
      if (deliveries.size > 1000) deliveries.delete(deliveries.values().next().value)
    }
    if (event === 'ping') return res.status(204).end()
    if (event !== 'push' && event !== 'release') return res.status(204).end()
    let payload
    try {
      payload = JSON.parse(req.body.toString('utf8'))
    } catch {
      return res.status(400).end()
    }
    const fullName = payload.repository?.full_name
    res.status(202).end()
    if (!fullName) return undefined
    const ids = await db.linksForRepo(fullName)
    for (const id of ids) {
      refreshLink(id, { mode: 'full', reason: copy.reasons.updated }).catch((error) => {
        console.error('webhook refresh failed', error.message)
      })
    }
    return undefined
  }))

  if (clerkOn()) {
    const clerkOptions = {
      secretKey: config.clerkSecretKey,
      publishableKey: config.clerkPublishableKey,
    }
    if (config.clerkPublishableKey.startsWith('pk_live_')) {
      clerkOptions.proxyUrl = `${config.publicUrl}/__clerk`
    }
    app.use(clerkMiddleware(clerkOptions))
  }

  app.use(express.json({ limit: '200kb' }))
  app.use((req, res, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next()
    if (req.path === '/api/github/webhook') return next()
    if (!sameOrigin(req)) return res.status(403).json({ message: copy.errors.generic })
    return next()
  })

  app.get('/api/me', wrap(async (req, res) => {
    let account = await accountFrom(req)
    if (account && hasGithub(account) && !github.profileName(account.name, account.login)) {
      try {
        const fresh = await github.profile(decrypt(account.token_ciphertext))
        const real = github.profileName(fresh.name, account.login)
        if (real) {
          await db.applyProfileName(account.id, account.login, real)
          account = await db.getAccount(account.id)
        }
      } catch (error) {
        console.error('profile name failed', error.message)
      }
    }
    if (account && account.headline == null) {
      const latest = await db.latestPerson(account.id)
      if (latest) {
        await db.rememberPerson(account.id, {
          name: github.profileName(account.name, account.login) || github.profileName(latest.display_name, account.login) || '',
          headline: latest.headline || '',
          location: latest.location || account.location || '',
        })
        account = await db.getAccount(account.id)
      }
    }
    res.json({
      account: account ? presentAccount(account) : null,
      guest: true,
      githubReady: Boolean(config.githubClientId && config.githubClientSecret),
      signInReady: clerkOn(),
      publishableKey: clerkOn() ? config.clerkPublishableKey : '',
    })
  }))

  app.get('/api/example', (_req, res) => {
    res.json({ resume: exampleResume() })
  })

  app.get('/api/auth/github', (req, res) => {
    if (!config.githubClientId || !config.githubClientSecret) {
      return res.redirect('/start?notice=setup')
    }
    if (!allow(`auth:${clientIp(req)}`, 20, 60_000)) {
      return res.status(429).json({ message: copy.errors.slowDown })
    }
    const visibility = 'all'
    const nonce = crypto.randomBytes(16).toString('hex')
    setCookie(res, 'kept_oauth', signPayload({ nonce, visibility, exp: Date.now() + 10 * 60 * 1000 }), 600)
    const scope = 'read:user user:email repo'
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', config.githubClientId)
    url.searchParams.set('redirect_uri', github.callbackUrl())
    url.searchParams.set('scope', scope)
    url.searchParams.set('state', nonce)
    return res.redirect(url.toString())
  })

  app.get('/github/auth/callback', wrap(async (req, res) => {
    if (req.query.error) return res.redirect('/start?notice=denied')
    const payload = readPayload(readCookies(req).kept_oauth)
    if (!payload || payload.nonce !== req.query.state || payload.exp < Date.now() || !req.query.code) {
      return res.redirect('/start?notice=denied')
    }
    const token = await github.exchangeCode(req.query.code)
    const profile = await github.profile(token.access_token)
    const githubFields = {
      ...profile,
      tokenCiphertext: encrypt(token.access_token),
      canReadPrivate: github.canReadPrivate(token.scope),
      preview: false,
    }
    let mine = null
    if (clerkOn()) {
      const { userId } = getAuth(req)
      if (userId) mine = await ensureClerkAccount(userId)
    }
    if (!mine) mine = await accountFromRequest(req)

    let account
    if (mine) {
      try {
        account = await db.connectGithub(mine, githubFields)
      } catch (error) {
        if (error.code === '23505') {
          clearCookie(res, 'kept_oauth')
          return res.redirect('/start?notice=taken')
        }
        throw error
      }
    } else {
      account = await db.upsertAccount(githubFields)
    }
    clearCookie(res, 'kept_oauth')
    if (!readCookies(req).kept_session) {
      const sessionId = await db.createSession(account.id)
      setCookie(res, 'kept_session', sessionId, 60 * 60 * 24 * 14)
    }
    return res.redirect(`/studio?visibility=${payload.visibility === 'all' ? 'all' : 'public'}`)
  }))

  app.post('/api/auth/logout', wrap(async (req, res) => {
    if (clerkOn()) {
      try {
        const { sessionId } = getAuth(req)
        if (sessionId) await clerkClient.sessions.revokeSession(sessionId)
      } catch (error) {
        console.error('sign out failed', error.message)
      }
      for (const name of ['__session', '__client_uat']) {
        const parts = [`${name}=`, 'Path=/', 'SameSite=Lax', 'Max-Age=0']
        if (config.isProd) parts.push('Secure')
        res.append('Set-Cookie', parts.join('; '))
      }
    }
    try {
      await db.deleteSession(readCookies(req).kept_session)
    } catch (error) {
      console.error('sign out failed', error.message)
    }
    clearCookie(res, 'kept_session')
    res.json({ ok: true })
  }))

  async function startGuestSession(req, res) {
    if (!allow(`guest:${clientIp(req)}`, 10, 60_000)) throw new HttpError(429, copy.errors.slowDown)
    const payload = await createGuestSession(res)
    res.status(201).json(payload)
  }

  app.post('/api/preview', wrap(async (req, res) => startGuestSession(req, res)))
  app.post('/api/guest', wrap(async (req, res) => {
    if (req.query.action === 'leave') {
      await endKeptSession(req, res)
      res.json({ ok: true })
      return
    }
    await startGuestSession(req, res)
  }))

  app.get('/api/projects', wrap(async (req, res) => {
    const account = await requireAccount(req)
    const visibility = req.query.visibility === 'all' ? 'all' : 'public'
    try {
      if (!usesSample(account) && !hasGithub(account)) {
        return res.json({ needGithub: true, projects: [] })
      }
      if (usesSample(account)) {
        const projects = listSampleProjects()
          .filter((project) => visibility === 'all' || !project.private)
          .map((project) => ({ ...project, updatedLabel: updatedLabel(project.pushedAt) }))
        return res.json({ projects })
      }
      if (visibility === 'all' && !account.can_read_private) {
        return res.json({ needPrivate: true, projects: [] })
      }
      const projects = await github.listRepos(decrypt(account.token_ciphertext), visibility)
      return res.json({
        projects: projects.map((project) => ({ ...project, updatedLabel: updatedLabel(project.pushedAt) })),
      })
    } catch (error) {
      throw mapGithubError(error)
    }
  }))

  app.get('/api/links', wrap(async (req, res) => {
    const account = await requireAccount(req)
    const links = await db.listLinks(account.id)
    res.json({
      links: links.map((link) => ({
        id: link.id,
        slug: link.slug,
        roleTarget: link.role_target || link.headline || link.display_name || copy.name,
        status: link.status,
        lastError: link.last_error || '',
        refreshedLabel: link.last_refreshed_at ? updatedLabel(link.last_refreshed_at) : '',
        pdfUrl: `${config.publicUrl}/r/${link.slug}.pdf`,
      })),
    })
  }))

  app.post('/api/links', wrap(async (req, res) => {
    const account = await requireAccount(req)
    if (!allow(`link:${account.id}`, 12, 60_000)) throw new HttpError(429, copy.errors.slowDown)
    const fields = cleanFields(req.body || {})
    let known
    try {
      known = new Set(await allowedRepos(account, fields.visibility))
    } catch (error) {
      throw mapGithubError(error)
    }
    if (fields.repos.some((repo) => !known.has(repo))) throw new HttpError(400, copy.errors.notOnList)
    const link = await db.createLink(account.id, fields)
    await db.rememberPerson(account.id, {
      name: fields.displayName,
      headline: fields.headline,
      location: fields.location,
    })
    res.status(201).json(await presentLink(link))
    refreshLink(link.id, { mode: 'full', reason: copy.reasons.first }).catch((error) => {
      console.error('create refresh failed', error.message)
    })
  }))

  app.get('/api/links/:id', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(404, copy.errors.missingLink)
    const account = await requireAccount(req)
    const link = await db.getLinkForAccount(req.params.id, account.id)
    if (!link) throw new HttpError(404, copy.errors.missingLink)
    res.json(await presentLink(link))
  }))

  app.patch('/api/links/:id/person', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(404, copy.errors.missingLink)
    const account = await requireAccount(req)
    try {
      const saved = await savePerson(account.id, req.params.id, req.body || {})
      if (!saved) throw new HttpError(404, copy.errors.missingLink)
      res.json(saved)
    } catch (error) {
      if (error.code === 'email') throw new HttpError(400, copy.errors.email)
      throw error
    }
  }))

  app.patch('/api/links/:id', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(404, copy.errors.missingLink)
    const account = await requireAccount(req)
    const existing = await db.getLinkForAccount(req.params.id, account.id)
    if (!existing) throw new HttpError(404, copy.errors.missingLink)
    const fields = cleanFields({ ...existingToBody(existing), ...req.body })
    let known
    try {
      known = new Set(await allowedRepos(account, fields.visibility))
    } catch (error) {
      throw mapGithubError(error)
    }
    if (fields.repos.some((repo) => !known.has(repo))) throw new HttpError(400, copy.errors.notOnList)
    const reposChanged = fields.repos.join('\n') !== (existing.selected_repos || []).join('\n')
      || fields.visibility !== existing.visibility
    const link = await db.updateLink(existing.id, account.id, {
      ...fields,
      selectedRepos: fields.repos,
      status: 'preparing',
    })
    if (reposChanged) await db.forgetUnselected(link.id, fields.repos)
    await db.rememberPerson(account.id, {
      name: fields.displayName,
      headline: fields.headline,
      location: fields.location,
    })
    res.json(await presentLink(link))
    const mode = reposChanged ? 'full' : 'reword'
    const reason = reposChanged ? copy.reasons.updated : copy.reasons.reword
    refreshLink(link.id, { mode, reason }).catch((error) => {
      console.error('save refresh failed', error.message)
    })
  }))

  app.get('/api/github/reader', wrap(async (req, res) => {
    const account = await requireAccount(req)
    res.setHeader('Cache-Control', 'no-store')
    if (usesSample(account)) return res.json({ preview: true })
    if (!account.can_read_private) throw new HttpError(403, copy.errors.needPrivate)
    if (!config.githubAppId || !config.githubAppPrivateKey) throw new HttpError(503, copy.errors.notReady)
    const id = String(req.query.link || '')
    if (!UUID.test(id)) throw new HttpError(404, copy.errors.missingLink)
    const link = await db.getLinkForAccount(id, account.id)
    if (!link) throw new HttpError(404, copy.errors.missingLink)
    const { localReads } = await presentLink(link)
    try {
      return res.json({ tokens: await readerTokens(localReads.map((read) => read.fullName)) })
    } catch (error) {
      if (!(error instanceof AppNotInstalled)) throw error
      const install = config.githubAppSlug ? `https://github.com/apps/${config.githubAppSlug}/installations/new` : ''
      return res.status(409).json({ message: copy.errors.needAppInstall, install })
    }
  }))

  app.post('/api/links/:id/local', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(404, copy.errors.missingLink)
    const account = await requireAccount(req)
    const existing = await db.getLinkForAccount(req.params.id, account.id)
    if (!existing) throw new HttpError(404, copy.errors.missingLink)
    const readings = cleanLocalReadings(req.body || {})
    const link = await applyLocalReadings(existing.id, readings)
    res.json(await presentLink(link))
  }))

  app.post('/api/links/:id/refresh', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(404, copy.errors.missingLink)
    const account = await requireAccount(req)
    const existing = await db.getLinkForAccount(req.params.id, account.id)
    if (!existing) throw new HttpError(404, copy.errors.missingLink)
    const forceFull = existing.status === 'preparing' || req.body?.full === true
    const result = await refreshLink(existing.id, {
      mode: forceFull ? 'full' : 'check',
      reason: forceFull ? copy.reasons.first : copy.reasons.updated,
    })
    const link = await db.getLink(existing.id)
    const body = await presentLink(link)
    if (!result.changed) body.message = copy.errors.upToDate
    res.json(body)
  }))

  app.delete('/api/links/:id', wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(404, copy.errors.missingLink)
    const account = await requireAccount(req)
    const removed = await db.deleteLink(req.params.id, account.id)
    if (!removed) throw new HttpError(404, copy.errors.missingLink)
    res.json({ ok: true, message: copy.notice.removed })
  }))

  app.get('/sample', wrap(async (_req, res) => {
    if (process.env.VERCEL) {
      res.redirect(302, `/r/${STATIC_EXAMPLE_SLUG}`)
      return
    }
    try {
      const link = await ensureSampleLink()
      res.redirect(302, `/r/${link.slug}`)
    } catch (error) {
      console.error(error)
      res.redirect(302, `/r/${STATIC_EXAMPLE_SLUG}`)
    }
  }))

  app.get('/example.pdf', wrap(async (_req, res) => {
    const resume = exampleResume()
    const pdf = await renderPdf(resume)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fileName(resume.name)}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(pdf)
  }))

  app.get('/r/:slug', wrap(async (req, res) => {
    const raw = req.params.slug
    const asPdf = raw.endsWith('.pdf')
    const slug = asPdf ? raw.slice(0, -4) : raw
    if (slug === STATIC_EXAMPLE_SLUG) {
      const resume = exampleResume()
      if (asPdf) {
        const pdf = await renderPdf(resume)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${fileName(resume.name)}"`)
        res.setHeader('Cache-Control', 'no-store')
        return res.send(pdf)
      }
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Robots-Tag', 'noindex, nofollow')
      return res.type('html').send(renderPublicPage({ slug: STATIC_EXAMPLE_SLUG, resume }))
    }
    if (!/^[a-z0-9]{10}$/.test(slug)) {
      return asPdf ? sendPdf(res, null, 404) : res.status(404).type('html').send(renderPublicPage(null))
    }
    const link = await db.getLinkBySlug(slug)
    if (!link) {
      return asPdf ? sendPdf(res, null, 404) : res.status(404).type('html').send(renderPublicPage(null))
    }
    refreshLink(link.id, { mode: 'check', reason: copy.reasons.updated, respectPoll: true }).catch(() => {})
    if (asPdf) return sendPdf(res, link)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    return res.type('html').send(renderPublicPage({ ...link, resume: await shownResume(link) }))
  }))

  app.get('/copy.js', (_req, res) => {
    res.type('application/javascript')
    res.sendFile(path.join(root, 'copy.js'))
  })

  app.use(express.static(publicDir))

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (path.extname(req.path) || isHiddenPath(req.path)) return res.status(404).end()
    return res.sendFile(path.join(publicDir, 'index.html'))
  })

  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message })
      return
    }
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({ message: copy.errors.generic })
      return
    }
    if (error.type === 'entity.too.large') {
      res.status(413).json({ message: copy.errors.generic })
      return
    }
    console.error(error)
    res.status(500).json({ message: copy.errors.generic })
  })

  return app
}

function ensureSampleLink() {
  if (!sampleLinkPromise) {
    sampleLinkPromise = loadSampleLink().finally(() => {
      sampleLinkPromise = null
    })
  }
  return sampleLinkPromise
}

async function loadSampleLink() {
  const account = await db.upsertAccount({
    githubId: SAMPLE_GITHUB_ID,
    login: 'sample',
    name: samplePerson.name,
    email: samplePerson.email,
    avatarUrl: '',
    bio: samplePerson.bio,
    blog: '',
    location: samplePerson.location,
    tokenCiphertext: encrypt('preview'),
    canReadPrivate: true,
    preview: true,
  })
  const existing = await db.listLinks(account.id)
  for (const item of existing) {
    const link = await db.getLink(item.id)
    if (link?.resume) return link
  }
  const pending = existing[0] ? await db.getLink(existing[0].id) : null
  const link = pending || await db.createLink(account.id, {
    visibility: 'all',
    displayName: samplePerson.name,
    headline: samplePerson.headline,
    email: samplePerson.email,
    location: samplePerson.location,
    roleTarget: samplePerson.headline,
    instructions: '',
    repos: listSampleProjects().map((project) => project.fullName),
  })
  await refreshLink(link.id, { mode: 'full', reason: copy.reasons.first })
  return db.getLink(link.id)
}

function existingToBody(link) {
  return {
    visibility: link.visibility,
    displayName: link.display_name,
    headline: link.headline,
    email: link.email,
    location: link.location,
    education: link.education || '',
    experience: link.experience || '',
    roleTarget: link.role_target,
    instructions: link.instructions,
    repos: link.selected_repos,
  }
}

export async function start() {
  assertConfig()
  await db.migrate()
  const timescale = db.features.timescale
  console.log(`tiger ready (timescale=${timescale})`)
  const app = buildApp()
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Kept listening on ${config.port}`)
  })
  startPoller()
  const shutdown = async () => {
    stopPoller()
    server.close()
    await db.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) {
  start().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
