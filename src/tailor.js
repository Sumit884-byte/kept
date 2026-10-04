import { config } from './config.js'
import { briefTokens } from './brief.js'
import { applyBrief, finishSections } from './resume.js'
import { skillsFor } from './skills.js'

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

function aboutText(project) {
  return [project.description, project.conclusion, ...(project.highlights || [])]
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}

function slimProject(project) {
  return {
    name: project.name,
    about: aboutText(project),
    language: project.language || '',
  }
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

export function namesFromDescriptions(projects, role) {
  const needles = briefTokens(role)
  const publicProjects = (projects || []).filter((project) => !project.private)
  if (!needles.length) return publicProjects.map((project) => project.name)
  return publicProjects
    .filter((project) => {
      const hay = `${project.name} ${aboutText(project)}`.toLowerCase()
      return needles.some((needle) => hay.includes(needle))
    })
    .map((project) => project.name)
}

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
  return (projects || []).filter((project) => !project.private)
}

export function roleChoiceRequest(projects, role) {
  const system = [
    'You choose which projects belong on a resume for one role.',
    'Decide from each project name and its full about, not from the title alone.',
    'Do not rewrite the about, and do not invent projects.',
    'Return JSON with one key, projects, an array of project names copied exactly from the list.',
    'Include a project only when that about fits the role. Order them by fit.',
  ].join(' ')
  return {
    model: config.llmModel,
    temperature: 0,
    store: false,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ role, projects: projects.map(slimProject) }) },
    ],
  }
}

async function namesFromModel(shareable, role, fetchImpl) {
  const response = await fetchImpl(`${config.llmBase}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llmKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(roleChoiceRequest(shareable, role)),
    signal: AbortSignal.timeout(25000),
  })
  if (!response.ok) return []
  const payload = await response.json()
  const text = payload?.choices?.[0]?.message?.content || ''
  const model = JSON.parse(text)
  return publicNamesForRole(shareable, model?.projects)
}

export async function tailorResume(resume, projects, prefs, fetchImpl = fetch) {
  const role = String(prefs.roleTarget || '').trim()
  if (!role) return finishSections(applyBrief(resume, prefs), projects, prefs)
  const shareable = projectsForRemote(projects)
  let names = []
  if (config.llmKey && shareable.length) {
    try {
      names = await namesFromModel(shareable, role, fetchImpl)
    } catch {
      names = []
    }
  }
  if (!names.length) names = namesFromDescriptions(shareable, role)
  if (!names.length && !shareable.length) return finishSections(applyBrief(resume, prefs), projects, prefs)
  return finishSections(applyBrief(resumeWithSelection(resume, projects, names), prefs), projects, prefs)
}
