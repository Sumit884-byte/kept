import crypto from 'node:crypto'
import { config } from './config.js'

const API = 'https://api.github.com'

export class AppNotInstalled extends Error {}

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

export function appJwt(appId = config.githubAppId, privateKey = config.githubAppPrivateKey, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60
  const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({ iat, exp: iat + 540, iss: String(appId) })}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')
  return `${unsigned}.${signature}`
}

async function appRequest(path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 404) throw new AppNotInstalled(path)
  if (!response.ok) throw new Error(`GitHub App request failed: ${response.status}`)
  return response.json()
}

export async function readerTokens(fullNames, { fetchImpl = fetch } = {}) {
  const byOwner = new Map()
  for (const fullName of fullNames) {
    const [owner, repo] = String(fullName).split('/')
    if (!owner || !repo) continue
    byOwner.set(owner, [...(byOwner.get(owner) || []), repo])
  }
  const tokens = {}
  for (const [owner, repos] of byOwner) {
    const installation = await appRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repos[0])}/installation`, { fetchImpl })
    const minted = await appRequest(`/app/installations/${installation.id}/access_tokens`, {
      method: 'POST',
      body: { repositories: repos, permissions: { contents: 'read' } },
      fetchImpl,
    })
    for (const repo of repos) tokens[`${owner}/${repo}`] = minted.token
  }
  return tokens
}
