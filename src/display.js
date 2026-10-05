export function displayProjectTitle(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (/^[A-Z][a-zA-Z0-9]*$/.test(raw) && !raw.includes('_') && !raw.includes('-')) return raw
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function normalizeRolePhrase(text) {
  return String(text || '')
    .replace(/\.$/, '')
    .toLowerCase()
    .replace(/\bdevloper\b/g, 'developer')
    .replace(/\s+/g, ' ')
    .trim()
}

export function introForPdf(resume) {
  const headline = String(resume.headline || '').trim()
  const summary = String(resume.summary || '').trim()
  if (!summary) return { headline, summary: '' }
  if (!headline) return { headline: '', summary }
  const h = normalizeRolePhrase(headline)
  const s = normalizeRolePhrase(summary)
  if (!h) return { headline: '', summary }
  if (s === h || s.startsWith(`${h} `) || summary.toLowerCase().startsWith(`${headline.replace(/\.$/, '').toLowerCase()}.`)) {
    return { headline: '', summary }
  }
  if (/^recent projects include\b/i.test(summary)) {
    return { headline: '', summary }
  }
  return { headline, summary }
}
