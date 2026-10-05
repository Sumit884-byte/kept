import { config } from './config.js'
import { isProfileReadmeProject } from './projectKinds.js'
import {
  MAX_PUBLIC,
  namesFromDescriptions,
  namesFromTerms,
  publicNamesForRole,
  termsFromBreakdown,
} from './rolePick.js'
import { applyBrief, finishSections } from './resume.js'
import { skillsFor } from './skills.js'

export {
  namesFromDescriptions,
  namesFromTerms,
  publicNamesForRole,
  roleTerms,
  termsFromBreakdown,
} from './rolePick.js'

function factBlob(project) {
  return JSON.stringify({
    name: project.name,
    description: project.description,
    conclusion: project.conclusion,
    highlights: project.highlights,
    language: project.language,
    numbers: project.numbers,
  })
}

export function lineIsGrounded(line, blob) {
  const nums = String(line).match(/\d[\d,]*(?:\.\d+)?%?/g) || []
  return nums.every((raw) => {
    const plain = raw.replace(/,/g, '').replace(/%$/, '')
    if (raw.includes('%')) return blob.includes(raw) || blob.includes(`${plain}%`)
    if (blob.includes(plain)) return true
    const asNumber = Number(plain)
    if (Number.isNaN(asNumber)) return false
    return blob.includes(asNumber.toLocaleString('en-US'))
  })
}

export function mergeTailored(original, model, projects) {
  const byName = new Map(projects.map((project) => [project.name, project]))
  const modelWork = Array.isArray(model?.work) ? model.work : []
  const work = []
  for (const item of original.work || []) {
    const match = modelWork.find((entry) => entry && entry.title === item.title)
    const project = byName.get(item.title)
    const blob = project ? factBlob(project) : JSON.stringify(item)
    if (!match || !Array.isArray(match.lines)) {
      work.push(item)
      continue
    }
    const grounded = match.lines
      .map((line) => String(line || '').trim())
      .filter((line) => line && lineIsGrounded(line, blob))
    work.push({ ...item, lines: grounded.length ? grounded.slice(0, 3) : item.lines })
  }
  const summary = typeof model?.summary === 'string' && lineIsGrounded(model.summary, JSON.stringify(projects))
    ? model.summary.trim()
    : original.summary
  const headline = typeof model?.headline === 'string' && lineIsGrounded(model.headline, JSON.stringify(projects))
    ? model.headline.trim()
    : original.headline
  const skills = skillsFor((projects || []).filter((project) => work.some((item) => item.title === project.name)))
  return {
    ...original,
    headline: headline || original.headline,
    summary: summary || original.summary,
    work,
    skills: skills.length ? skills : original.skills,
  }
}

const MIN_PUBLIC = 3

export function resumeWithSelection(resume, projects, names) {
  const picked = publicNamesForRole(projects, names)
  const privateNames = new Set((projects || []).filter((project) => project.private).map((project) => project.name))
  const work = []
  for (const name of picked) {
    const item = (resume.work || []).find((entry) => entry.title === name)
    if (item) work.push(item)
  }
  for (const item of resume.work || []) {
    if (privateNames.has(item.title)) work.push(item)
  }
  const shown = new Set(work.map((item) => item.title))
  return {
    ...resume,
    work,
    summary: '',
    skills: skillsFor((projects || []).filter((project) => shown.has(project.name))),
  }
}

export function projectsForRemote(projects) {
  return (projects || []).filter((project) => !project.private && !isProfileReadmeProject(project))
}

function boostRoleMatches(names, shareable, role) {
  const picked = [...names]
  if (!picked.length || picked.length >= MIN_PUBLIC) return picked
  for (const name of namesFromDescriptions(shareable, role)) {
    if (picked.length >= MIN_PUBLIC) break
    if (!picked.includes(name)) picked.push(name)
  }
  return picked.slice(0, MAX_PUBLIC)
}

export function roleBreakdownRequest(role) {
  const system = [
    'Break one job role into the skills and tech stacks a resume should show.',
    'Return JSON with two keys, skills and stacks.',
    'Each is an array of short phrases people write in project descriptions.',
    'Do not list projects.',
  ].join(' ')
  return {
    model: config.llmModel,
    temperature: 0,
    store: false,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ role }) },
    ],
  }
}

async function termsFromModel(role, fetchImpl) {
  const headers = { 'Content-Type': 'application/json' }
  if (config.llmKey) headers.Authorization = `Bearer ${config.llmKey}`
  const response = await fetchImpl(`${config.llmBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(roleBreakdownRequest(role)),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return []
  const payload = await response.json()
  const text = String(payload?.choices?.[0]?.message?.content || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  return termsFromBreakdown(JSON.parse(text))
}

export async function tailorResume(resume, projects, prefs, fetchImpl = fetch) {
  const role = String(prefs.roleTarget || '').trim()
  if (!role) return finishSections(applyBrief(resume, prefs), projects, prefs)
  const shareable = projectsForRemote(projects)
  let terms = []
  if (config.llmBase && shareable.length) {
    try {
      terms = await termsFromModel(role, fetchImpl)
    } catch {
      terms = []
    }
  }
  let names = terms.length ? namesFromTerms(shareable, terms) : []
  if (!names.length) names = namesFromDescriptions(shareable, role)
  names = boostRoleMatches(names, shareable, role)
  if (!names.length && shareable.length > MAX_PUBLIC) {
    return finishSections(applyBrief({ ...resume, work: [], summary: '' }, prefs), projects, prefs)
  }
  if (!names.length) names = shareable.map((project) => project.name).slice(0, MAX_PUBLIC)
  if (!names.length) {
    return finishSections(applyBrief({ ...resume, work: [], summary: '' }, prefs), projects, prefs)
  }
  const drafted = resumeWithSelection(resume, projects, names)
  return finishSections(applyBrief(drafted, prefs), projects, prefs)
}
