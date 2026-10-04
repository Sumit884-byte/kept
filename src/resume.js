import { copy } from './copy.js'
import { attentionSentence, enhancementSentence, joinList } from './phrases.js'
import { briefTokens, containsPhrase, neverPhrases, wantsFirstPerson } from './brief.js'

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

export function bulletsFor(project) {
  const lines = []
  if (project.conclusion) lines.push(project.conclusion)
  const enhancement = enhancementSentence(project.numbers)
  if (enhancement) lines.push(enhancement)
  const attention = attentionSentence(project.numbers)
  if (attention) lines.push(attention)
  const stated = statedLine(project)
  if (stated) lines.push(stated)
  return lines.slice(0, 3)
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
    const line = (prefs.headline || '').trim()
    if (line && line.toLowerCase() === role.toLowerCase()) return `Recent projects include ${names}.`
    return `${role}. Recent projects include ${names}.`
  }
  if (person.bio) return trimText(person.bio, 320)
  return `Recent projects include ${names}.`
}

function skillsFor(projects) {
  const skills = []
  for (const project of projects) {
    if (project.language && !skills.includes(project.language)) skills.push(project.language)
  }
  return skills.slice(0, 8)
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
    next.summary = copy.pdf.nothingToShow
    return next
  }
  if (!next.summary) {
    const names = joinList(next.work.map((item) => item.title))
    const role = (prefs.roleTarget || '').trim()
    const line = (prefs.headline || '').trim()
    if (wantsFirstPerson(prefs.instructions) && role) next.summary = `I'm aiming at ${role} roles. My recent projects include ${names}.`
    else if (wantsFirstPerson(prefs.instructions)) next.summary = `My recent projects include ${names}.`
    else if (role && line.toLowerCase() !== role.toLowerCase()) next.summary = `${role}. Recent projects include ${names}.`
    else next.summary = `Recent projects include ${names}.`
  }
  return next
}

export function composeResume({ person, projects, prefs }) {
  const chosen = orderedProjects(projects, prefs).slice(0, 8)
  const work = chosen.map((project) => ({
    title: project.name,
    url: project.private ? '' : String(project.url || '').replace(/^https?:\/\//, ''),
    lines: bulletsFor(project),
  }))
  const resume = {
    name: person.name || 'Resume',
    contact: [person.email, person.location, person.blog, person.login ? `github.com/${person.login}` : '']
      .map((part) => String(part || '').trim())
      .filter(Boolean),
    headline: (prefs.headline || prefs.roleTarget || '').trim(),
    summary: summaryFor(person, chosen, prefs),
    work,
    skills: skillsFor(chosen),
    example: Boolean(person.example),
  }
  return applyBrief(resume, prefs)
}
