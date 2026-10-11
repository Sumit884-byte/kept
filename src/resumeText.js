import { copy } from './copy.js'
import { fileName } from './pdfText.js'
import { resumeOutline } from './resumeOutline.js'

export const TEXT_FORMATS = ['md', 'txt', 'json']

const TYPES = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

function outline(resume) {
  return resumeOutline(resume) || { name: '', contact: [], headline: '', summary: '', liveUrl: '', sections: [] }
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

// A line that opens with a Markdown marker would turn into a heading, a rule, a fence or a nested list.
function md(value) {
  return oneLine(value)
    .replace(/([\\`*_[\]<>])/g, '\\$1')
    .replace(/^([#~+-])/, '\\$1')
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
}

export function resumeMarkdown(resume) {
  const doc = outline(resume)
  const out = [`# ${md(doc.name || 'Resume')}`]
  if (doc.contact.length) out.push('', doc.contact.map(md).join(' · '))
  if (doc.headline) out.push('', `*${md(doc.headline)}*`)
  if (doc.summary) out.push('', md(doc.summary))
  for (const section of doc.sections) {
    out.push('', `## ${md(section.title)}`, '')
    if (section.kind === 'lines') {
      out.push(...section.lines.map((line) => `- ${md(line)}`))
    } else if (section.kind === 'skills') {
      out.push(md(section.text))
    } else {
      section.projects.forEach((item, index) => {
        if (index) out.push('')
        out.push(`### ${md(item.title)}${item.stars ? ` (${md(item.stars)})` : ''}`, '')
        if (item.url) out.push(`<https://${oneLine(item.url).replace(/^https?:\/\//, '').replace(/[<>\s]/g, '')}>`, '')
        out.push(...item.lines.map((line) => `- ${md(line)}`))
      })
    }
  }
  if (doc.liveUrl) out.push('', `<${oneLine(doc.liveUrl).replace(/[<>\s]/g, '')}>`)
  return `${out.join('\n')}\n`
}

export function resumePlainText(resume) {
  const doc = outline(resume)
  const out = [oneLine(doc.name || 'Resume')]
  if (doc.contact.length) out.push(doc.contact.map(oneLine).join(' | '))
  if (doc.headline) out.push('', oneLine(doc.headline))
  if (doc.summary) out.push('', oneLine(doc.summary))
  for (const section of doc.sections) {
    out.push('', oneLine(section.title).toUpperCase())
    if (section.kind === 'lines') {
      out.push(...section.lines.map((line) => `- ${oneLine(line)}`))
    } else if (section.kind === 'skills') {
      out.push(oneLine(section.text))
    } else {
      for (const item of section.projects) {
        out.push('', `${oneLine(item.title)}${item.stars ? ` (${oneLine(item.stars)})` : ''}`)
        if (item.url) out.push(oneLine(item.url))
        out.push(...item.lines.map((line) => `- ${oneLine(line)}`))
      }
    }
  }
  if (doc.liveUrl) out.push('', oneLine(doc.liveUrl))
  return `${out.join('\n')}\n`
}

function projectEntry(item) {
  const entry = { name: item.title, highlights: item.lines }
  if (item.lines[0]) entry.description = item.lines[0]
  if (item.url) entry.url = `https://${String(item.url).replace(/^https?:\/\//, '')}`
  return entry
}

// The contact line is written as email, place, site, GitHub, with any of them left out.
function contactParts(resume, contact) {
  const email = contact.find((item) => /^[^\s@]+@[^\s@]+$/.test(item)) || ''
  const github = contact.find((item) => /^github\.com\/[\w-]+$/i.test(item)) || ''
  const rest = contact.filter((item) => item !== email && item !== github)
  // A link says which entry is the place. A place can look like an address, as St.Petersburg does.
  const known = oneLine(resume?.place)
  if (known && rest.includes(known)) return { email, github, place: known, site: rest.find((item) => item !== known) || '' }
  if (rest.length > 1) return { email, github, place: rest[0], site: rest[1] }
  const only = rest[0] || ''
  // With no link to ask, capitals are the hint: mira.dev is a site and St.Petersburg is a place.
  const domain = typeof resume?.place === 'string'
    ? /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i
    : /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/
  const address = /^(?:https?:\/\/|www\.)\S+$/i.test(only) || domain.test(only)
  return { email, github, place: address ? '' : only, site: address ? only : '' }
}

// The shape follows jsonresume.org. Experience and education are kept as the lines the person wrote.
export function resumeJson(resume) {
  const doc = outline(resume)
  const { email, github, place, site } = contactParts(resume, doc.contact.map(oneLine).filter(Boolean))
  const basics = { name: oneLine(doc.name) }
  if (doc.headline) basics.label = oneLine(doc.headline)
  if (email) basics.email = email
  if (site) basics.url = /^https?:\/\//.test(site) ? site : `https://${site}`
  if (doc.summary) basics.summary = oneLine(doc.summary)
  if (place) basics.location = { address: place }
  if (github) basics.profiles = [{ network: 'GitHub', username: github.split('/')[1], url: `https://${github}` }]
  const out = { basics }
  for (const section of doc.sections) {
    if (section.kind === 'skills') {
      out.skills = section.text.split(',').map(oneLine).filter(Boolean).map((name) => ({ name }))
    } else if (section.kind === 'lines') {
      const lines = section.lines.map(oneLine).filter(Boolean)
      if (section.title === copy.pdf.experience) out.work = lines.map((summary) => ({ summary }))
      else out.education = lines.map((institution) => ({ institution }))
    } else if (section.editable) {
      out.projects = section.projects.map(projectEntry)
    } else {
      out.projects = [...(out.projects || []), ...section.projects.map((item) => ({ ...projectEntry(item), type: 'contribution' }))]
    }
  }
  if (doc.liveUrl) out.meta = { canonical: oneLine(doc.liveUrl) }
  return `${JSON.stringify(out, null, 2)}\n`
}

export function resumeAs(resume, format) {
  const body = format === 'md' ? resumeMarkdown(resume) : format === 'json' ? resumeJson(resume) : resumePlainText(resume)
  return { type: TYPES[format] || TYPES.txt, name: fileName(resume?.name, format), body }
}
