import { createClerkClient } from '@clerk/backend'
import { config } from './config.js'
import { copy } from './copy.js'
import { decrypt, encrypt } from './cryptoBox.js'
import * as db from './db.js'
import { exampleResume } from './example.js'
import { clerkSecret, lightSession, paintPerson, personFields, projectCounts, publishableKey } from './fast.js'
import { listRepos, profileName } from './github.js'
import { listSampleProjects, samplePerson } from './sample.js'
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './sessionCookie.js'
import { accountKind } from './public/accountBinding.js'
import { updatedLabel } from './when.js'
import crypto from 'node:crypto'

function present(account) {
  const login = account.login
  return {
    name: profileName(account.name, login),
    login,
    email: account.email || '',
    location: account.location || '',
    headline: account.headline,
    bio: account.bio || '',
    canReadPrivate: account.can_read_private,
    preview: accountKind(account).sample,
    githubConnected: accountKind(account).connected,
    clerk: Boolean(account.clerk_user_id),
  }
}

function primaryEmail(user) {
  const list = user?.emailAddresses || []
  const primary = list.find((item) => item.id === user.primaryEmailAddressId) || list[0]
  return primary?.emailAddress || ''
}

function clerkClient() {
  const secret = clerkSecret()
  const key = publishableKey()
  if (!secret || !key) return null
  return createClerkClient({ secretKey: secret, publishableKey: key })
}

export async function clerkUserId(req) {
  const clerk = clerkClient()
  if (!clerk) return ''
  const forwarded = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const host = String(Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
  const protoHeader = req.headers['x-forwarded-proto'] || 'https'
  const proto = String(Array.isArray(protoHeader) ? protoHeader[0] : protoHeader).split(',')[0].trim()
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (value == null) continue
    headers.set(name, Array.isArray(value) ? value.join(',') : String(value))
  }
  headers.set('host', host)
  const origin = `${proto}://${host}`
  const request = new Request(`${origin}${req.url || '/'}`, { method: req.method || 'GET', headers })
  const options = publishableKey().startsWith('pk_live_') ? { proxyUrl: `${origin}/__clerk` } : {}
  const state = await clerk.authenticateRequest(request, options)
  return state.toAuth()?.userId || ''
}

async function accountForClerk(userId) {
  const existing = await db.getAccountByClerkId(userId)
  if (existing) return existing
  const clerk = clerkClient()
  if (!clerk) return null
  const user = await clerk.users.getUser(userId)
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

export async function signedInAccount(req) {
  const userId = await clerkUserId(req)
  if (!userId) return null
  return accountForClerk(userId)
}

async function rememberHeadline(account) {
  if (!account || account.headline != null) return account
  const latest = await db.latestPerson(account.id)
  if (!latest) return account
  await db.rememberPerson(account.id, {
    name: profileName(account.name, account.login) || profileName(latest.display_name, account.login) || '',
    headline: latest.headline || '',
    location: latest.location || account.location || '',
  })
  return db.getAccount(account.id)
}

export async function readMe(req) {
  const base = lightSession()
  if (!config.tigerUrl) return base
  try {
    let account = await accountFromRequest(req)
    account = await rememberHeadline(account)
    const payload = { ...base, account: account ? present(account) : null }
    if (account && accountKind(account).sample) Object.assign(payload, previewProjectPayload('all'))
    return payload
  } catch (error) {
    console.error('readMe failed', error.message)
    return base
  }
}

export function previewProjectPayload(scope = 'all') {
  const projects = listSampleProjects()
    .filter((project) => scope === 'all' || !project.private)
    .map((project) => ({ ...project, updatedLabel: updatedLabel(project.pushedAt) }))
  return { projects, counts: projectCounts(projects) }
}

export async function createGuestSession(res) {
  const account = await db.upsertAccount({
    githubId: `preview:${crypto.randomUUID()}`,
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
  const sessionId = await db.createSession(account.id)
  writeSessionCookie(res, sessionId, 60 * 60 * 24)
  return { account: present(account), ...previewProjectPayload('all') }
}

export function readExample() {
  return { resume: exampleResume() }
}

export async function endKeptSession(req, res) {
  const sessionId = readSessionCookie(req)
  if (sessionId && config.tigerUrl) {
    try {
      await db.migrate()
      await db.deleteSession(sessionId)
    } catch (error) {
      console.error('kept session delete failed', error.message)
    }
  }
  clearSessionCookie(res)
}

export async function accountFromRequest(req) {
  try {
    const account = await signedInAccount(req)
    if (account) return account
  } catch (error) {
    console.error('sign-in lookup failed', error.message)
  }
  const sessionId = readSessionCookie(req)
  if (!sessionId) return null
  const session = await db.getSession(sessionId)
  if (!session) return null
  return db.getAccount(session.account_id)
}

export async function readProjects(req, visibility) {
  const account = await accountFromRequest(req)
  if (!account) {
    const error = new Error('signed-out')
    error.status = 401
    throw error
  }
  const scope = visibility === 'all' ? 'all' : 'public'
  const kind = accountKind(account)
  if (!kind.sample && !kind.connected) {
    return { needGithub: true, projects: [], counts: projectCounts([]) }
  }
  if (kind.sample) {
    return previewProjectPayload(scope)
  }
  if (scope === 'all' && !account.can_read_private) {
    return { needPrivate: true, projects: [], counts: projectCounts([]) }
  }
  const projects = (await listRepos(decrypt(account.token_ciphertext), scope))
    .map((project) => ({ ...project, updatedLabel: updatedLabel(project.pushedAt) }))
  return { projects, counts: projectCounts(projects) }
}

export async function readLinks(req) {
  const account = await accountFromRequest(req)
  if (!account) {
    const error = new Error('signed-out')
    error.status = 401
    throw error
  }
  const links = await db.listLinks(account.id)
  return {
    links: links.map((link) => ({
      id: link.id,
      slug: link.slug,
      roleTarget: link.role_target || link.headline || link.display_name || copy.name,
      status: link.status,
      lastError: link.last_error || '',
      refreshedLabel: link.last_refreshed_at ? updatedLabel(link.last_refreshed_at) : '',
      pdfUrl: `${config.publicUrl}/r/${link.slug}.pdf`,
    })),
  }
}

export async function savePerson(accountId, linkId, body) {
  const fields = personFields(body)
  const existing = await db.getLinkForAccount(linkId, accountId)
  if (!existing) return null
  const resume = existing.resume ? paintPerson(existing.resume, fields) : null
  const link = await db.updateLink(linkId, accountId, fields)
  if (!link) return null
  if (resume) {
    await db.query(
      'UPDATE links SET resume = $3::jsonb WHERE id = $1 AND account_id = $2',
      [linkId, accountId, JSON.stringify(resume)],
    )
    link.resume = resume
  }
  await db.rememberPerson(accountId, {
    name: fields.displayName,
    headline: fields.headline,
    location: fields.location,
  })
  return {
    displayName: link.display_name || '',
    headline: link.headline || '',
    email: link.email || '',
    location: link.location || '',
    education: link.education || '',
    experience: link.experience || '',
    resume: link.resume,
  }
}
