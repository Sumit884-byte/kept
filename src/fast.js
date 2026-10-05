import { educationLines, experienceLines } from './resume.js'

const EMAIL = /^[^\s@]+@[^\s@]+$/

export function publishableKey() {
  return process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || ''
}

export function clerkSecret() {
  return process.env.CLERK_SECRET_KEY || process.env.NEXT_PUBLIC_CLERK_SECRET_KEY || ''
}

export function lightSession() {
  const key = publishableKey()
  return {
    account: null,
    guest: true,
    githubReady: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    signInReady: Boolean(key && clerkSecret()),
    publishableKey: key,
  }
}

export function personFields(body) {
  const email = String(body?.email || '').trim()
  if (email && (email.length > 200 || !EMAIL.test(email))) {
    const error = new Error('email')
    error.code = 'email'
    throw error
  }
  return {
    displayName: String(body?.displayName || '').trim().slice(0, 120),
    headline: String(body?.headline || '').trim().slice(0, 180),
    email,
    location: String(body?.location || '').trim().slice(0, 120),
    education: String(body?.education || '').trim().slice(0, 1200),
    experience: String(body?.experience || '').trim().slice(0, 1200),
    work: Array.isArray(body?.work) ? body.work.slice(0, 12).map((item) => ({
      title: String(item?.title || '').slice(0, 160),
      lines: (Array.isArray(item?.lines) ? item.lines : []).slice(0, 4).map((line) => String(line || '').trim().slice(0, 400)).filter(Boolean),
    })).filter((item) => item.title) : undefined,
  }
}

export function personOnly(next, link) {
  if (!next || !link) return false
  const repos = [...new Set(next.repos || [])].join('\n')
  const current = [...(link.selectedRepos || [])].join('\n')
  return repos === current
    && (next.visibility || 'public') === (link.visibility || 'public')
    && (next.roleTarget || '') === (link.roleTarget || '')
    && (next.instructions || '') === (link.instructions || '')
}

export function paintPerson(resume, fields) {
  if (!resume) return resume
  const github = (resume.contact || []).find((item) => /^github\.com\//i.test(String(item)))
  const contact = [fields.email, fields.location, github].filter(Boolean)
  return {
    ...resume,
    name: fields.displayName || resume.name || '',
    headline: fields.headline || '',
    contact,
    education: educationLines(fields.education),
    experience: experienceLines(fields.experience),
    work: paintWork(resume.work, fields.work),
  }
}

function paintWork(work, edits) {
  if (!Array.isArray(edits) || !edits.length) return work || []
  const byTitle = new Map(edits.map((item) => [item.title, item.lines]))
  return (work || []).map((item) => {
    const lines = byTitle.get(item.title)
    return lines ? { ...item, lines } : item
  })
}

export function isLightPath(pathname, method = 'GET') {
  if (pathname === '/api/links') return method === 'GET'
  if (pathname === '/api/guest' && method === 'POST') return true
  return pathname === '/api/me'
    || pathname === '/api/example'
    || pathname === '/api/projects'
    || pathname === '/api/auth/github'
    || pathname === '/api/github/callback'
    || pathname === '/github/auth/callback'
}

export function projectCounts(projects) {
  const list = projects || []
  return {
    public: list.filter((project) => !project.private).length,
    private: list.filter((project) => project.private).length,
    forks: list.filter((project) => project.fork).length,
    all: list.length,
  }
}
