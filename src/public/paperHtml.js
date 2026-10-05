/** HTML preview structure aligned with resumeTemplateClassic PDF. */
import { copy } from './copy.js'
import { displayProjectTitle, introForPdf } from './display.js'

function starLabel(count) {
  const n = Math.max(0, Math.round(Number(count) || 0))
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'star' : 'stars'}`
}

function sectionTitle(label, esc) {
  return `<h2 class="paper-section-title">${esc(label)}</h2>`
}

function projectBlock(item, esc, { editing }) {
  const title = displayProjectTitle(item.title)
  const stars = Number(item.stars) || 0
  const lines = item.lines || []
  return `<section class="paper-role">
    <h3>${esc(title)}${stars > 0 ? `<span class="star-count">${esc(starLabel(stars))}</span>` : ''}</h3>
    ${item.url ? `<p class="paper-url">${esc(item.url)}</p>` : ''}
    <ul>${lines.map((line, index) => editing
      ? `<li><input class="paper-edit" data-work-title="${esc(item.title)}" data-work-line="${index}" value="${esc(line)}"></li>`
      : `<li>${esc(line)}</li>`).join('')}</ul>
  </section>`
}

export function renderPaperHtml(resume, esc, { editing = false, nameTag = 'h2' } = {}) {
  if (!resume) return ''
  const intro = introForPdf(resume)
  const contact = (resume.contact || []).map((item) => `<span>${esc(item)}</span>`).join('')
  const work = (resume.work || []).map((item) => projectBlock(item, esc, { editing })).join('')
  const contributions = (resume.contributions || []).map((item) => projectBlock({
    title: item.title,
    url: item.url,
    stars: 0,
    lines: [item.line],
  }, esc, { editing: false })).join('')

  return `<article class="paper paper-classic">
    <div class="paper-header-band">
      ${resume.example ? `<p class="paper-eyebrow">${esc(copy.pdf.example)}</p>` : ''}
      <${nameTag} class="paper-name">${esc(resume.name)}</${nameTag}>
      ${contact ? `<p class="paper-contact">${contact}</p>` : ''}
    </div>
    <div class="paper-body">
      ${intro.headline || intro.summary ? `<div class="paper-intro">${intro.headline ? `<p class="paper-line">${esc(intro.headline)}</p>` : ''}${intro.summary ? `<p class="paper-summary">${esc(intro.summary)}</p>` : ''}</div>` : ''}
      ${(resume.experience || []).length ? `${sectionTitle(copy.pdf.experience, esc)}<ul class="paper-education">${resume.experience.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
      ${(resume.education || []).length ? `${sectionTitle(copy.pdf.education, esc)}<ul class="paper-education">${resume.education.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
      ${resume.skills?.length ? `${sectionTitle(copy.pdf.skills, esc)}<p class="paper-skills">${esc(resume.skills.join(', '))}</p>` : ''}
      ${work ? `${sectionTitle(copy.pdf.selectedWork, esc)}${work}` : ''}
      ${contributions ? `${sectionTitle(copy.pdf.contributions, esc)}${contributions}` : ''}
    </div>
  </article>`
}
