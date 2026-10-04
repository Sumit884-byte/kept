import { skillsFromEvidence } from './skills.js'

const PLACEHOLDER = /^(todo|tbd|fixme|description|add a description)\b/i

export function plainWriting(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9]*/g, ' ')
    .replace(/<[^>\n]{0,300}>/g, ' ')
    .replace(/\b(?:align|src|alt|width|height|href|class|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/(^|\s)\/+(?=\s|$)/g, ' ')
    .replace(/\b(?:src|alt|href|align|width|height|class|style)\s*…?\s*$/i, '')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
}

const MARKUP_NOISE = /badge|shields\.io|npm version|license|star the repo|build status/i

export function assessReadme(markdown) {
  if (!markdown || !String(markdown).trim()) {
    return { score: 0, thin: true, prose: '', stated: [] }
  }
  const text = plainWriting(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_`~|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = text.split(' ').filter(Boolean)
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(' ').filter(Boolean).length >= 6)
    .filter((sentence) => !MARKUP_NOISE.test(sentence))
  const stated = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\d/.test(sentence) && sentence.length < 140 && sentence.split(' ').length >= 3)
    .filter((sentence) => !MARKUP_NOISE.test(sentence))
    .slice(0, 2)
  const thin = sentences.length === 0 || PLACEHOLDER.test(text) || words.length < 12
  const prose = (thin ? [] : sentences.slice(0, 2)).join(' ')
  const score = thin ? Math.min(0.35, words.length / 200) : Math.min(1, words.length / 80)
  return { score, thin, prose, stated }
}

function purpose(name, description) {
  const clean = description.trim().replace(/[.]+$/, '')
  if (clean.toLowerCase().startsWith(name.toLowerCase())) {
    return /[.!?]$/.test(description.trim()) ? description.trim() : `${clean}.`
  }
  return `${name} is ${clean.charAt(0).toLowerCase()}${clean.slice(1)}.`.replace(/\.\.$/, '.')
}

export function humanAction(routePath) {
  const parts = String(routePath)
    .split('/')
    .filter(Boolean)
    .filter((part) => !['api', 'v1', 'v2', 'v3', 'internal'].includes(part.toLowerCase()))
    .filter((part) => !part.startsWith(':') && !part.startsWith('{'))
  const last = parts.at(-1)
  if (!last) return ''
  return last.replace(/\.(json|html|xml)$/i, '').replace(/[-_]+/g, ' ').trim()
}

const ROUTE = /(?:app|router|route|r)\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]|@(?:app|router)\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi

export function actionsFrom(files) {
  const found = []
  for (const file of files || []) {
    const text = String(file.text || '')
    for (const match of text.matchAll(ROUTE)) {
      const action = humanAction(match[1] || match[2] || '')
      if (action && !found.includes(action)) found.push(action)
    }
  }
  return found.slice(0, 6)
}

const KIND_RULES = [
  [['react', 'next', 'vue', 'svelte', '@angular/core'], 'a web app'],
  [['express', 'fastify', 'koa', 'hono'], 'a web service'],
  [['fastapi', 'flask', 'django'], 'a web service'],
  [['tensorflow', 'torch', 'pytorch', 'scikit-learn', 'pandas'], 'a data project'],
  [['react-native', 'expo'], 'a mobile app'],
]

export function kindFrom(deps, files) {
  const names = new Set((deps || []).map((dep) => dep.toLowerCase()))
  const paths = (files || []).map((file) => file.path.toLowerCase())
  for (const [needles, label] of KIND_RULES) {
    if (needles.some((needle) => names.has(needle) || [...names].some((name) => name.startsWith(`${needle}/`)))) {
      return label
    }
  }
  if (paths.some((file) => file.endsWith('.jsx') || file.endsWith('.tsx') || file.endsWith('.vue'))) return 'a web app'
  if (paths.some((file) => file.endsWith('.py'))) return 'a Python project'
  return ''
}

export function manifestOf(files) {
  const pkg = (files || []).find((file) => file.path === 'package.json' || file.path.endsWith('/package.json'))
  if (!pkg) return { description: '', deps: [], command: '' }
  try {
    const json = JSON.parse(pkg.text)
    const deps = Object.keys({ ...json.dependencies, ...json.devDependencies })
    const command = json.bin ? Object.keys(json.bin)[0] || '' : ''
    return { description: json.description || '', deps, command }
  } catch {
    return { description: '', deps: [], command: '' }
  }
}

const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|test|style|perf)(\([^)]+\))?!?:\s*/i
const BORING = /^(merge|wip|bump|chore|dependabot|update readme|updates|update|fix|fixes|cleanup|clean up)\b/i

function cleanCommit(message) {
  const clean = String(message || '').split('\n')[0].replace(CONVENTIONAL, '').trim().replace(/\.+$/, '')
  if (clean.length < 13 || BORING.test(clean)) return ''
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

export function recentWork(commits) {
  const ordered = [...(commits || [])].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  for (const commit of ordered) {
    const clean = cleanCommit(commit.message)
    if (clean) return clean
  }
  return ''
}

export function notableWork(commits) {
  const ordered = [...(commits || [])].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  const lines = []
  for (const commit of ordered) {
    const clean = cleanCommit(commit.message)
    if (!clean || lines.includes(clean)) continue
    lines.push(clean)
    if (lines.length === 3) break
  }
  return lines
}

function trimSentence(text, max) {
  const clean = String(text || '').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).trim()}…`
}

export function buildConclusion({ name, description, readme, files, commits }) {
  const manifest = manifestOf(files)
  const actions = actionsFrom(files)
  const kind = kindFrom(manifest.deps, files)
  const recent = recentWork(commits)
  if (!readme.thin && readme.prose) {
    const extras = readme.stated.filter((line) => !readme.prose.includes(line.slice(0, Math.min(20, line.length))))
    return {
      conclusion: trimSentence([readme.prose, ...extras].join(' '), 500),
      highlights: actions,
      readmeWasThin: false,
    }
  }
  const sentences = []
  const described = description || manifest.description
  if (described) sentences.push(purpose(name, described))
  else if (kind) sentences.push(`${name} is ${kind}.`)
  if (actions.length) sentences.push(`It handles ${joinAnd(actions)}.`)
  else if (!described && !kind) sentences.push(`${name} has little written about it, so this comes from the project itself.`)
  if (manifest.command) sentences.push(`It can be started with the ${manifest.command} command.`)
  if (recent) sentences.push(`Recent work: ${recent}.`)
  return {
    conclusion: sentences.join(' '),
    highlights: actions,
    readmeWasThin: true,
  }
}

function joinAnd(items) {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function safePaths(paths) {
  return (paths || [])
    .filter((filePath) => typeof filePath === 'string' && /^[\w./-]+$/.test(filePath) && !filePath.includes('..'))
    .slice(0, 6)
}

function shortRelease(name) {
  const clean = String(name || '').trim()
  if (!clean || clean.length > 24) return ''
  return clean
}

export function interpret(gathered) {
  const repo = gathered.repo
  const name = repo.name || String(repo.full_name || '').split('/').at(-1) || 'Project'
  const readme = assessReadme(gathered.readme)
  const files = gathered.files || []
  const commits = gathered.commits || []
  const needsLocal = Boolean(repo.private) && readme.thin && files.length === 0
  const written = buildConclusion({
    name,
    description: repo.description || '',
    readme,
    files: needsLocal ? [] : files,
    commits,
  })
  const manifest = needsLocal ? { deps: [] } : manifestOf(files)
  const languages = Array.isArray(repo.languages) ? repo.languages : []
  const skills = skillsFromEvidence({
    language: repo.language || '',
    languages,
    deps: manifest.deps,
    text: [repo.description, written.conclusion, ...(written.highlights || [])].filter(Boolean).join('\n'),
  })
  const window = gathered.window
  const commitAdditions = commits.reduce((sum, commit) => sum + (Number(commit.additions) || 0), 0)
  const commitDeletions = commits.reduce((sum, commit) => sum + (Number(commit.deletions) || 0), 0)
  const releases = gathered.releases || []
  const latest = releases[0]
  const numbers = {
    days: 90,
    commits: window ? window.commits : commits.length,
    additions: window ? window.additions : commitAdditions,
    deletions: window ? window.deletions : commitDeletions,
    complete: Boolean(window?.complete),
    releases: releases.length,
    latestRelease: shortRelease(latest?.name || latest?.tag || ''),
    stars: Number(repo.stars) || 0,
    forks: Number(repo.forks) || 0,
    openIssues: Number(repo.openIssues) || 0,
    stated: readme.stated,
  }
  const project = {
    fullName: repo.full_name,
    name,
    url: repo.url || '',
    private: Boolean(repo.private),
    language: repo.language || '',
    languages,
    skills,
    description: repo.description || '',
    conclusion: written.conclusion,
    highlights: written.highlights,
    contributions: notableWork(commits),
    readmeWasThin: written.readmeWasThin,
    numbers,
  }
  return {
    project,
    signal: {
      stars: numbers.stars,
      forks: numbers.forks,
      openIssues: numbers.openIssues,
      watchers: Number(repo.watchers) || 0,
      commits: numbers.commits,
      additions: numbers.additions,
      deletions: numbers.deletions,
      releases: numbers.releases,
      readmeScore: readme.score,
      language: project.language,
    },
    reading: {
      readmeWasThin: written.readmeWasThin,
      conclusion: written.conclusion,
      detail: {
        highlights: written.highlights,
        contributions: notableWork(commits),
        skills,
        languages,
        stated: readme.stated,
        private: project.private,
        needsLocal,
        filePaths: needsLocal ? safePaths(gathered.filePaths) : [],
        url: project.url,
        displayName: name,
        description: project.description,
        latestRelease: numbers.latestRelease,
        windowComplete: numbers.complete,
      },
    },
  }
}
