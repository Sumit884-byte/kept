import { briefTokens } from './brief.js'
import { isProfileReadmeProject } from './projectKinds.js'

const SHORT_STOP = new Set(['to', 'of', 'in', 'on', 'an', 'is', 'or', 'be', 'as', 'at', 'by', 'if', 'it', 'we', 'do', 'so', 'no', 'up', 'a'])
const ROLE_WORDS = new Set(['developer', 'devloper', 'engineer', 'senior', 'junior', 'staff', 'lead', 'intern', 'software', 'programmer', 'scientist'])
const GENERIC = new Set(['python', 'javascript', 'typescript', 'api', 'sql', 'node', 'java', 'data', 'product', 'learning', 'full', 'stack', 'app', 'web', 'code', 'tool', 'tools', 'mobile'])
const ROLE_STACKS = [
  [/\b(ai|ml|llm|genai|machine learning)\b/, ['machine learning', 'llm', 'language model', 'pytorch', 'nlp', 'rag', 'agent', 'ai', 'ml', 'computer vision', 'opencv']],
  [/\b(front ?end|frontend|react)\b/, ['react', 'typescript', 'css', 'frontend', 'tailwind', 'next']],
  [/\b(back ?end|backend)\b/, ['fastapi', 'django', 'flask', 'express', 'postgres', 'graphql', 'backend']],
  [/\bdata (scientist|science|engineer)|\banalyst\b/, ['pandas', 'machine learning', 'notebook', 'statistics', 'data science', 'sentiment']],
  [/\bmobile\b/, ['react native', 'swift', 'kotlin', 'flutter']],
  [/\b(full[\s-]?stack)\b/, ['full stack', 'react', 'next', 'fastapi']],
  [/\b(designer|design)\b/, ['figma', 'css', 'ui', 'landing', 'tailwind']],
]

export const MAX_PUBLIC = 8

function aboutText(project) {
  return [project.description, project.conclusion, ...(project.highlights || [])]
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}

function wordList(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+.#\s/-]/g, ' ')
    .split(/[\s/]+/)
    .flatMap((part) => part.split('-'))
    .map((word) => word.replace(/\./g, '').replace(/^[+#]+|[+#]+$/g, ''))
    .filter((word) => word.length > 1 && !SHORT_STOP.has(word))
}

function gramSet(text) {
  const words = wordList(text).flatMap((word) => (
    word.endsWith('js') && word.length > 4 ? [word, word.slice(0, -2)] : [word]
  ))
  const grams = new Set(words)
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      grams.add(words.slice(index, index + size).join(' '))
    }
  }
  return grams
}

function uniqueTerms(terms) {
  const seen = new Set()
  const out = []
  for (const term of terms) {
    const phrase = wordList(term).join(' ')
    if (!phrase || phrase.length > 40 || seen.has(phrase)) continue
    seen.add(phrase)
    out.push(phrase)
  }
  return out.slice(0, 24)
}

export function roleTerms(role) {
  const fixed = String(role || '').toLowerCase().replace(/\bdevloper\b/g, 'developer')
  const terms = []
  for (const [pattern, extra] of ROLE_STACKS) {
    if (pattern.test(fixed)) terms.push(...extra)
  }
  for (const token of briefTokens(fixed)) {
    if (!ROLE_WORDS.has(token)) terms.push(token)
  }
  for (const word of wordList(fixed)) {
    if (['ai', 'ml', 'ui', 'ux', 'go', 'js'].includes(word)) terms.push(word)
  }
  return uniqueTerms(terms)
}

export function termsFromBreakdown(model) {
  const lists = [model?.skills, model?.stacks]
  const terms = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) terms.push(String(item || ''))
  }
  return uniqueTerms(terms)
}

function pickPool(projects) {
  return (projects || []).filter((project) => !project.fork && !isProfileReadmeProject(project))
}

function termWeight(term) {
  if (term.split(' ').length > 1) return 3
  if (GENERIC.has(term)) return 1
  return 2
}

function scoreProjects(projects, terms, { publicOnly = false } = {}) {
  const needles = uniqueTerms(terms)
  let pool = pickPool(projects)
  if (publicOnly) pool = pool.filter((project) => !project.private)
  if (!needles.length) {
    return publicOnly
      ? pool.map((project) => project.name).slice(0, MAX_PUBLIC)
      : []
  }
  return pool
    .map((project, index) => {
      const grams = gramSet(`${project.name} ${aboutText(project)} ${project.language || ''}`)
      let score = 0
      let specific = false
      for (const term of needles) {
        if (!grams.has(term)) continue
        const weight = termWeight(term)
        score += weight
        if (weight >= 2) specific = true
      }
      return { project, name: project.name, score: specific ? score : 0, index }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_PUBLIC)
    .map((row) => row.name)
}

export function namesFromTerms(projects, terms) {
  return scoreProjects(projects, terms, { publicOnly: true })
}

export function namesFromDescriptions(projects, role) {
  return namesFromTerms(projects, roleTerms(role))
}

export function pickNamesFromRole(projects, role) {
  return scoreProjects(projects, roleTerms(role), { publicOnly: false })
}

export function fullNamesForRole(projects, role) {
  const roleText = String(role || '').trim()
  if (!roleText) return []
  const pool = pickPool(projects)
  const names = pickNamesFromRole(pool, roleText)
  const byName = new Map(pool.map((project) => [String(project.name).toLowerCase(), project.fullName]))
  const out = []
  for (const name of names) {
    const full = byName.get(String(name).toLowerCase())
    if (full && !out.includes(full)) out.push(full)
  }
  return out
}

export function publicNamesForRole(projects, names) {
  const allowed = new Map(
    (projects || [])
      .filter((project) => !project.private)
      .map((project) => [String(project.name).toLowerCase(), project.name]),
  )
  const picked = []
  for (const name of names || []) {
    const exact = allowed.get(String(name).trim().toLowerCase())
    if (exact && !picked.includes(exact)) picked.push(exact)
  }
  return picked
}
