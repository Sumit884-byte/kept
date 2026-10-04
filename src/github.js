import crypto from 'node:crypto'
import { assessReadme } from './analyze.js'
import { config } from './config.js'

export class GithubError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export function verifyGithubSignature(rawBody, header, secret) {
  if (!header || !secret || !rawBody) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const left = Buffer.from(String(header))
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export function parseNext(link) {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/)
    if (match) return match[1].replace(/^https:\/\/api\.github\.com/, '')
  }
  return null
}

async function gh(token, path, { method = 'GET', body, etag, raw = false } = {}) {
  const headers = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kept-resume',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(etag ? { 'If-None-Match': etag } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 304) {
    return { notModified: true, etag: response.headers.get('etag'), status: 304 }
  }
  if (response.status === 202) {
    return { pending: true, status: 202, etag: response.headers.get('etag') }
  }
  const text = await response.text()
  const isJson = (response.headers.get('content-type') || '').includes('json')
  let data = null
  if (!raw && text && isJson) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    throw new GithubError(data?.message || response.statusText || 'GitHub request failed', response.status)
  }
  return {
    notModified: false,
    pending: false,
    status: response.status,
    data: raw ? text : data,
    text,
    etag: response.headers.get('etag'),
    link: response.headers.get('link'),
    headers: response.headers,
  }
}

async function optional(promise, fallback) {
  try {
    return await promise
  } catch (error) {
    if (error instanceof GithubError && (error.status === 404 || error.status === 409)) return fallback
    throw error
  }
}

async function quiet(promise, fallback) {
  try {
    return await promise
  } catch {
    return fallback
  }
}

export async function exchangeCode(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'kept-resume',
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: `${config.publicUrl}/api/auth/callback`,
    }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    throw new GithubError(data.error_description || 'GitHub did not grant access', response.status || 400)
  }
  return data
}

export async function profile(token) {
  const user = await gh(token, '/user')
  const emails = await optional(gh(token, '/user/emails'), { data: [] })
  const list = Array.isArray(emails.data) ? emails.data : []
  const primary = list.find((email) => email.primary && email.verified) || list.find((email) => email.verified)
  return {
    githubId: String(user.data.id),
    login: user.data.login,
    name: user.data.name || user.data.login,
    email: primary?.email || user.data.email || '',
    avatarUrl: user.data.avatar_url || '',
    bio: user.data.bio || '',
    blog: user.data.blog || '',
    location: user.data.location || '',
  }
}

export async function listRepos(token, visibility) {
  const scope = visibility === 'all' ? 'all' : 'public'
  let path = `/user/repos?per_page=100&sort=updated&visibility=${scope}&affiliation=owner,collaborator,organization_member`
  const repos = []
  for (let page = 0; page < 3 && path; page += 1) {
    const response = await gh(token, path)
    repos.push(...(response.data || []))
    path = parseNext(response.link)
  }
  return repos
    .filter((repo) => !repo.archived && !repo.fork && !repo.disabled)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 40)
    .map((repo) => ({
      fullName: repo.full_name,
      name: repo.name,
      description: repo.description || '',
      private: Boolean(repo.private),
      language: repo.language || '',
      pushedAt: repo.pushed_at,
      stars: repo.stargazers_count || 0,
    }))
}

const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.rb', '.java', '.kt', '.php', '.ex', '.cs'])
const MANIFESTS = ['package.json', 'pyproject.toml', 'setup.py', 'Cargo.toml', 'go.mod', 'composer.json', 'Gemfile', 'mix.exs']

function extname(file) {
  const index = file.lastIndexOf('.')
  return index === -1 ? '' : file.slice(index).toLowerCase()
}

function wantedFiles(tree, thin) {
  const files = (tree || []).filter((item) => item.type === 'blob' && item.path && !item.path.includes('node_modules') && !item.path.includes('vendor/') && !item.path.includes('dist/'))
  const manifests = files.filter((item) => MANIFESTS.some((name) => item.path === name || item.path.endsWith(`/${name}`)))
  if (!thin) return manifests.slice(0, 2)
  const source = files
    .filter((item) => SOURCE_EXT.has(extname(item.path)) && (item.size || 0) < 150000 && !item.path.includes('.min.'))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, 5)
  return [...manifests.slice(0, 2), ...source].slice(0, 6)
}

async function fileText(token, fullName, path) {
  const response = await optional(
    gh(token, `/repos/${fullName}/contents/${encodeURI(path)}`, { raw: true }),
    { data: '' },
  )
  return String(response.data || '').slice(0, 12000)
}

function sumWeeks(rows, valueIndex) {
  const cutoff = Date.now() / 1000 - 90 * 86400
  return (rows || [])
    .filter((row) => Array.isArray(row) && row[0] >= cutoff)
    .reduce((sum, row) => sum + Math.abs(Number(row[valueIndex]) || 0), 0)
}

function sumActivity(rows) {
  const cutoff = Date.now() / 1000 - 90 * 86400
  return (rows || [])
    .filter((row) => row && row.week >= cutoff)
    .reduce((sum, row) => sum + (Number(row.total) || 0), 0)
}

export async function gatherRepo(token, fullName, etag) {
  const repoRes = await gh(token, `/repos/${fullName}`, { etag })
  if (repoRes.notModified) return { notModified: true, etag: repoRes.etag }
  const repo = repoRes.data
  const readmeRes = await optional(gh(token, `/repos/${fullName}/readme`, { raw: true }), { data: '' })
  const readme = String(readmeRes.data || '')
  const branch = repo.default_branch || 'HEAD'
  const treeRes = await optional(gh(token, `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`), { data: { tree: [] } })
  const thin = assessReadme(readme).thin
  const tree = treeRes.data?.tree || []
  let files = []
  let filePaths = []
  if (repo.private) {
    if (thin) filePaths = wantedFiles(tree, true).map((item) => item.path)
  } else {
    const chosen = wantedFiles(tree, thin)
    for (const item of chosen) {
      const text = await fileText(token, fullName, item.path)
      if (text) files.push({ path: item.path, text })
    }
  }
  const since = new Date(Date.now() - 90 * 86400000).toISOString()
  const commitRes = await optional(gh(token, `/repos/${fullName}/commits?since=${encodeURIComponent(since)}&per_page=30`), { data: [] })
  const commits = (commitRes.data || []).map((commit) => ({
    message: commit.commit?.message || '',
    date: commit.commit?.author?.date || '',
    additions: 0,
    deletions: 0,
  }))
  const frequency = await quiet(gh(token, `/repos/${fullName}/stats/code_frequency`), { pending: true, data: null })
  const activity = await quiet(gh(token, `/repos/${fullName}/stats/commit_activity`), { pending: true, data: null })
  let window = null
  if (!frequency.pending && Array.isArray(frequency.data) && !activity.pending && Array.isArray(activity.data)) {
    window = {
      additions: sumWeeks(frequency.data, 1),
      deletions: sumWeeks(frequency.data, 2),
      commits: sumActivity(activity.data),
      complete: true,
    }
  } else {
    let additions = 0
    let deletions = 0
    const sample = (commitRes.data || []).slice(0, 8)
    for (const item of sample) {
      if (!item.sha) continue
      const full = await optional(gh(token, `/repos/${fullName}/commits/${item.sha}`), null)
      additions += full?.data?.stats?.additions || 0
      deletions += full?.data?.stats?.deletions || 0
    }
    if (sample.length) {
      window = { additions, deletions, commits: sample.length, complete: false }
    }
  }
  const releaseRes = await optional(gh(token, `/repos/${fullName}/releases?per_page=20`), { data: [] })
  const cutoff = Date.now() - 90 * 86400000
  const releases = (releaseRes.data || [])
    .filter((release) => !release.draft && release.published_at && new Date(release.published_at).getTime() >= cutoff)
    .map((release) => ({ name: release.tag_name || release.name || '', publishedAt: release.published_at }))
  const languages = await optional(gh(token, `/repos/${fullName}/languages`), { data: {} })
  const language = Object.entries(languages.data || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || repo.language || ''
  return {
    notModified: false,
    etag: repoRes.etag,
    pushedAt: repo.pushed_at,
    repo: {
      full_name: repo.full_name,
      name: repo.name,
      description: repo.description || '',
      private: Boolean(repo.private),
      language,
      url: repo.html_url,
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      openIssues: repo.open_issues_count || 0,
      watchers: repo.subscribers_count || 0,
      pushedAt: repo.pushed_at,
    },
    readme,
    files,
    filePaths,
    commits,
    releases,
    window,
  }
}

export async function ensureHook(token, fullName) {
  if (!config.publicUrl.startsWith('https://')) return null
  const hookUrl = `${config.publicUrl}/api/github/webhook`
  const existing = await optional(gh(token, `/repos/${fullName}/hooks`), { data: [] })
  const found = (existing.data || []).find((hook) => hook?.config?.url === hookUrl)
  if (found) return found.id
  const created = await gh(token, `/repos/${fullName}/hooks`, {
    method: 'POST',
    body: {
      name: 'web',
      active: true,
      events: ['push', 'release'],
      config: {
        url: hookUrl,
        content_type: 'json',
        secret: config.webhookSecret,
        insecure_ssl: '0',
      },
    },
  })
  return created.data?.id || null
}

export function canReadPrivate(scope) {
  return String(scope || '').split(/[\s,]+/).includes('repo')
}
