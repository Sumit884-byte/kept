import { copy } from './copy.js'
import { displayProjectTitle, introForPdf } from './display.js'

function starLabel(count) {
  const n = Math.max(0, Math.round(Number(count) || 0))
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'star' : 'stars'}`
}

function project(item) {
  const stars = Number(item.stars) || 0
  const source = item.lines || (item.line ? [item.line] : [])
  return {
    rawTitle: String(item.title || ''),
    title: displayProjectTitle(item.title),
    stars: stars > 0 ? starLabel(stars) : '',
    url: item.url || '',
    lines: source.map((line) => String(line || '').trim()).filter(Boolean).slice(0, 3),
  }
}

export function resumeOutline(resume) {
  if (!resume) return null
  const intro = introForPdf(resume)
  const sections = []
  const add = (section) => sections.push({ ...section, first: sections.length === 0 })
  if ((resume.experience || []).length) add({ kind: 'lines', title: copy.pdf.experience, lines: resume.experience })
  if ((resume.education || []).length) add({ kind: 'lines', title: copy.pdf.education, lines: resume.education })
  if ((resume.skills || []).length) add({ kind: 'skills', title: copy.pdf.skills, text: resume.skills.join(', ') })
  if ((resume.work || []).length) {
    add({ kind: 'projects', title: copy.pdf.selectedWork, editable: true, projects: resume.work.map(project) })
  }
  if ((resume.contributions || []).length) {
    add({ kind: 'projects', title: copy.pdf.contributions, editable: false, projects: resume.contributions.map(project) })
  }
  return {
    example: Boolean(resume.example),
    exampleLabel: copy.pdf.example,
    name: resume.name || '',
    contact: resume.contact || [],
    headline: intro.headline || '',
    summary: intro.summary || '',
    liveUrl: resume.liveUrl || '',
    sections,
  }
}
