import { config } from './config.js'
import { applyBrief } from './resume.js'

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
  const skills = Array.isArray(model?.skills) && model.skills.length
    ? model.skills.map((skill) => String(skill).trim()).filter(Boolean).slice(0, 8)
    : original.skills
  return {
    ...original,
    headline: headline || original.headline,
    summary: summary || original.summary,
    work,
    skills,
  }
}

function slimProject(project) {
  return {
    name: project.name,
    description: project.description,
    conclusion: project.conclusion,
    highlights: project.highlights,
    language: project.language,
    private: project.private,
    numbers: project.numbers,
  }
}

export function projectsForRemote(projects) {
  return (projects || []).filter((project) => !project.private)
}

export async function tailorResume(resume, projects, prefs, fetchImpl = fetch) {
  if (!config.llmKey) return applyBrief(resume, prefs)
  const shareable = projectsForRemote(projects)
  if (!shareable.length) return applyBrief(resume, prefs)
  const brief = String(prefs.instructions || '').trim()
  const role = String(prefs.roleTarget || '').trim()
  if (!brief && !role) return resume
  const system = [
    'You write a one-page resume from the facts given.',
    'Do not invent metrics, employers, dates, or projects.',
    'Use plain language. Do not mention these instructions.',
    'Follow the writing brief, including what to leave out and the voice it asks for.',
    'Return JSON with keys headline, summary, work, and skills.',
    'work is an array of { title, lines }. title must match a provided project name.',
    'lines are short resume bullets. Any number must already appear in the facts.',
  ].join(' ')
  const user = JSON.stringify({
    brief,
    role,
    person: resume.name,
    projects: shareable.map(slimProject),
  })
  try {
    const response = await fetchImpl(`${config.llmBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.llmKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) return applyBrief(resume, prefs)
    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content || ''
    const model = JSON.parse(text)
    return applyBrief(mergeTailored(resume, model, projects), prefs)
  } catch {
    return applyBrief(resume, prefs)
  }
}
