import { plainWriting } from './analyze.js'
import { copy } from './copy.js'
import { isProfileReadmeProject } from './projectKinds.js'
import { attentionSentence, joinList } from './phrases.js'
import { briefTokens, containsPhrase, neverPhrases, wantsFirstPerson } from './brief.js'
import { skillsFor } from './skills.js'

export function experienceLines(value) {
  return educationLines(value)
}

export function educationLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => line.slice(0, 160))
}

export function contributionsForRole(projects, pulls, role) {
  const needles = briefTokens(role)
  if (!needles.length) return []
  const items = []
  const seen = new Set()
  function add(item) {
    const line = String(item.line || '').trim()
    if (!line || seen.has(line.toLowerCase())) return
    const hay = `${item.title || ''} ${line} ${item.text || ''}`.toLowerCase()
    if (!needles.some((needle) => hay.includes(needle))) return
    seen.add(line.toLowerCase())
    items.push({
      title: String(item.title || '').trim(),
      line,
      url: String(item.url || '').replace(/^https?:\/\//, ''),
      outside: Boolean(item.outside),
    })
  }
  for (const project of projects || []) {
    for (const line of project.contributions || []) {
      add({
        title: project.name,
        line,
        url: project.private ? '' : project.url,
      })
    }
  }
  for (const pull of pulls || []) {
    add({
      title: pull.where || pull.title,
      line: pull.title,
      text: pull.text,
      url: pull.url,
      outside: true,
    })
  }
  return items.slice(0, 4)
}

export function finishSections(resume, projects, prefs = {}) {
  if (!resume) return resume
  const kept = new Set((resume.work || []).map((item) => item.title))
  const used = (projects || []).filter((project) => kept.has(project.name))
  const banned = neverPhrases(prefs.instructions)
  const role = prefs.roleTarget || ''
  const skills = skillsFor(used.length ? used : projects, {
    role,
    profileText: prefs.profileText || '',
  }).filter((skill) => !containsPhrase(skill, banned))
  const forks = forkEntries(projects)
    .filter((item) => !containsPhrase(item.line, banned) && !containsPhrase(item.title, banned))
  const contributions = [...forks, ...contributionsForRole(used.length ? used : projects, prefs.pulls, role)]
    .filter((item) => !containsPhrase(item.line, banned) && !containsPhrase(item.title, banned))
    .filter((item, index, list) => list.findIndex((other) => other.title === item.title && other.line === item.line) === index)
    .slice(0, 6)
  const education = educationLines(prefs.education ?? resume.education)
    .filter((line) => !containsPhrase(line, banned))
  const experience = experienceLines(prefs.experience ?? resume.experience)
    .filter((line) => !containsPhrase(line, banned))
  return { ...resume, skills, contributions, education, experience }
}

function trimText(text, max) {
  const clean = String(text || '').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const stop = cut.lastIndexOf(' ')
  return `${(stop > 40 ? cut.slice(0, stop) : cut).trim()}…`
}

function scoreProject(project, prefs, index) {
  const hay = [
    project.name,
    project.description,
    project.conclusion,
    project.language,
    ...(project.highlights || []),
  ].join(' ').toLowerCase()
  const needles = briefTokens(`${prefs.roleTarget || ''} ${prefs.instructions || ''}`)
  let score = 0
  for (const needle of needles) {
    if (hay.includes(needle)) score += 2
  }
  score += Math.min(project.numbers?.stars || 0, 40) / 40
  return { project, score, index }
}

export function orderedProjects(projects, prefs) {
  return projects
    .map((project, index) => scoreProject(project, prefs, index))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.project)
}

function statedLine(project) {
  const stated = project.numbers?.stated || []
  const conclusion = project.conclusion || ''
  for (const line of stated) {
    if (line && !conclusion.includes(line.slice(0, Math.min(24, line.length)))) return line
  }
  return ''
}

const UNUSED_LINE = /has little written about it|created by leap|leap\.new|create-next-app|code bundle for|original project is available|this is a next\.js project bootstrapped/i
const INSTRUCTION = /\b(npm|pnpm|yarn|npx|pip)\b|install the dependencies|running the code|development server|click the|speak your message|^\d+\.\s|^(click|run|open|install|clone|download)\b/i
const SOCIAL_CHAIN = /\b(portfolio|linkedin|dev\.to|substack|x\/twitter)\b/i

function trimBioSpam(text) {
  let clean = String(text || '').trim()
  if (!clean) return ''
  if (SOCIAL_CHAIN.test(clean) || (clean.match(/·/g) || []).length >= 2) {
    clean = clean.split(/\bPortfolio\b|\bLinkedIn\b|·/i)[0].trim()
  }
  const [first = clean, second = ''] = clean.split(/(?<!\b(?:e\.g|i\.e|etc|vs|incl|approx)\.)(?<=[.!?])\s+/)
  const sentence = first.length < 60 && second && first.length + second.length < 220 ? `${first} ${second}` : first
  return sentence.length > 220 ? `${sentence.slice(0, 217).trim()}…` : sentence
}

export function readableLine(text) {
  const raw = String(text || '')
  let clean = plainWriting(raw)
    .replace(/\s+\d+\.\s+.*$/, '')
    .replace(/\b(running the code|run npm|first,?\s+run|click the|speak your).*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean || UNUSED_LINE.test(clean) || INSTRUCTION.test(clean)) return ''
  if (/[<>]|align\s*=|src(?:set)?\s*=|media\s*=|prefers-color-scheme/i.test(clean)) return ''
  if (/<[a-z!/]/i.test(raw) && clean.split(' ').filter(Boolean).length < 6) return ''
  if (/^(the latest \d+ updates|over the last three months|about [\d,]+ lines (added|removed)|[\d,]+ lines (added|removed)|\d+ releases? shipped)\b/i.test(clean)) return ''
  if (/^github profile readme\b/i.test(clean)) return ''
  clean = trimBioSpam(clean)
  return clean
}

export function starLabel(count) {
  const n = Math.max(0, Math.round(Number(count) || 0))
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'star' : 'stars'}`
}

export function placeForks(resume, projects) {
  const forks = new Map(forkEntries(projects).map((item) => [String(item.title || '').toLowerCase(), item]))
  if (!resume || !forks.size) return resume
  const work = []
  const moved = []
  for (const item of resume.work || []) {
    const fork = forks.get(String(item.title || '').toLowerCase())
    if (fork) moved.push(fork)
    else work.push(item)
  }
  const contributions = [
    ...moved,
    ...(resume.contributions || []).filter((item) => !forks.has(String(item.title || '').toLowerCase())),
  ]
  return { ...resume, work, contributions }
}

export function withSkills(resume, projects, prefs = {}) {
  if (!resume) return resume
  const shown = new Set((resume.work || []).map((item) => String(item.title || '').toLowerCase()))
  const used = (projects || []).filter((project) => shown.has(String(project.name || '').toLowerCase()))
  const education = prefs.education ?? (resume.education || []).join('\n')
  if (!used.length) return { ...resume, education: educationLines(education) }
  const pulls = prefs.pulls || (resume.contributions || []).filter((item) => item.outside)
  return finishSections(resume, used, {
    roleTarget: prefs.roleTarget || '',
    profileText: prefs.profileText || '',
    education,
    pulls,
    instructions: prefs.instructions || '',
  })
}

export function withStars(resume, projects) {
  if (!resume) return resume
  const byName = new Map()
  for (const project of projects || []) {
    const stars = Number(project.numbers?.stars)
    if (!Number.isFinite(stars)) continue
    byName.set(String(project.name || '').toLowerCase(), stars)
  }
  return {
    ...resume,
    work: (resume.work || []).map((item) => {
      const known = byName.get(String(item.title || '').toLowerCase())
      const stars = known == null ? item.stars : known
      return stars == null ? item : { ...item, stars }
    }),
  }
}

function normLine(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function significantWords(text) {
  return normLine(text).split(' ').filter((word) => word.length > 3)
}

function repeatsLine(candidate, kept) {
  const next = normLine(candidate)
  if (!next) return true
  const nextWords = new Set(significantWords(candidate))
  for (const line of kept) {
    const prev = normLine(line)
    if (!prev) continue
    if (prev === next || prev.includes(next) || next.includes(prev)) return true
    const prevWords = significantWords(line)
    if (prevWords.length < 4 || nextWords.size < 4) continue
    const shared = prevWords.filter((word) => nextWords.has(word)).length
    if (shared / Math.min(prevWords.length, nextWords.size) >= 0.6) return true
  }
  return false
}

function withoutTitle(line, title) {
  const name = String(title || '').trim()
  if (!name) return line
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[:\\s,-]*`, 'i')
  const rest = line.replace(pattern, '').trim()
  return /^[a-z]/.test(rest) ? line : rest
}

export function uniqueLines(lines, title = '') {
  const kept = []
  for (const line of lines || []) {
    const clean = withoutTitle(String(line || '').trim(), title)
    if (!clean || repeatsLine(clean, kept)) continue
    kept.push(clean)
  }
  return kept
}

export function readableResume(resume) {
  if (!resume) return resume
  const work = (resume.work || [])
    .map((item) => ({
      ...item,
      lines: uniqueLines((item.lines || []).map(readableLine).filter(Boolean), item.title),
    }))
    .filter((item) => item.title)
  const summary = readableLine(resume.summary)
  return {
    ...resume,
    work,
    summary: summary || resume.summary || '',
  }
}

export function forkEntries(projects) {
  return (projects || []).filter((project) => project.fork).slice(0, 4).map((project) => {
    const commit = (project.contributions || []).map((line) => readableLine(line)).find(Boolean)
    const description = readableLine(project.description)
    return {
      title: project.name,
      line: commit || description || 'Contributed to this project.',
      url: project.private ? '' : String(project.url || '').replace(/^https?:\/\//, ''),
      outside: true,
      fork: true,
    }
  })
}

export function bulletsFor(project) {
  const lines = []
  const description = readableLine(project.description)
  const conclusion = readableLine(project.conclusion)
  if (description) lines.push(description)
  if (conclusion && conclusion !== description) lines.push(conclusion)
  const attention = attentionSentence(project.numbers)
  if (attention) lines.push(attention)
  const stated = readableLine(statedLine({ ...project, conclusion }))
  if (stated) lines.push(stated)
  return uniqueLines(lines, project.name).slice(0, 4)
}

function summaryFor(person, projects, prefs) {
  const role = prefs.roleTarget?.trim()
  const names = joinList(projects.slice(0, 3).map((project) => project.name))
  if (!names) return person.bio ? trimText(person.bio, 280) : ''
  if (wantsFirstPerson(prefs.instructions)) {
    const aim = role ? `I'm aiming at ${role} roles.` : ''
    return [aim, `My recent projects include ${names}.`].filter(Boolean).join(' ')
  }
  if (role) {
    const line = (prefs.headline || prefs.roleTarget || '').trim()
    if (line && line.toLowerCase() === role.toLowerCase()) return `Recent projects include ${names}.`
    if (line) return `Recent projects include ${names}.`
    return `${role}. Recent projects include ${names}.`
  }
  if (person.bio) return trimText(person.bio, 320)
  return `Recent projects include ${names}.`
}

export function applyBrief(resume, prefs = {}) {
  const banned = neverPhrases(prefs.instructions)
  const work = []
  for (const item of resume.work || []) {
    if (containsPhrase(item.title, banned)) continue
    const lines = (item.lines || []).map((line) => line.trim()).filter((line) => line && !containsPhrase(line, banned))
    if (!lines.length) continue
    work.push({ ...item, lines })
  }
  const skills = (resume.skills || []).filter((skill) => !containsPhrase(skill, banned))
  let summary = resume.summary || ''
  if (containsPhrase(summary, banned)) summary = ''
  let headline = resume.headline || ''
  if (containsPhrase(headline, banned)) headline = ''
  const next = { ...resume, work, skills, summary, headline }
  if (!next.work.length) {
    next.summary = banned.length ? copy.pdf.nothingToShow : (prefs.roleTarget ? copy.pdf.noneFit : next.summary)
    return next
  }
  if (!next.summary) {
    const names = joinList(next.work.map((item) => item.title))
    const role = (prefs.roleTarget || '').trim()
    const line = (prefs.headline || prefs.roleTarget || '').trim()
    if (wantsFirstPerson(prefs.instructions) && role) next.summary = `I'm aiming at ${role} roles. My recent projects include ${names}.`
    else if (wantsFirstPerson(prefs.instructions)) next.summary = `My recent projects include ${names}.`
    else if (role && line && line.toLowerCase() !== role.toLowerCase()) next.summary = `${role}. Recent projects include ${names}.`
    else next.summary = `Recent projects include ${names}.`
  }
  return next
}

export function composeResume({ person, projects, prefs }) {
  const chosen = orderedProjects(
    (projects || []).filter((project) => !project.fork && !isProfileReadmeProject(project)),
    prefs,
  )
  const work = chosen.map((project) => ({
    title: project.name,
    url: project.private ? '' : String(project.url || '').replace(/^https?:\/\//, ''),
    stars: Number(project.numbers?.stars) || 0,
    lines: bulletsFor(project),
  }))
  const draft = applyBrief({
    name: person.name || 'Resume',
    contact: [person.email, person.location, person.blog, person.login ? `github.com/${person.login}` : '']
      .map((part) => String(part || '').trim())
      .filter(Boolean),
    headline: (prefs.headline || prefs.roleTarget || '').trim(),
    summary: summaryFor(person, chosen, prefs),
    work,
    skills: [],
    example: Boolean(person.example),
  }, prefs)
  return finishSections(draft, projects, prefs)
}
