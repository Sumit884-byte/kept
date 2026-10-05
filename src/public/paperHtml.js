import { resumeOutline } from './resumeOutline.js'

function sectionTitle(label, esc) {
  return `<h2 class="paper-section-title">${esc(label)}</h2>`
}

function projectBlock(item, esc, { editing }) {
  return `<section class="paper-role">
    <h3>${esc(item.title)}${item.stars ? `<span class="star-count">${esc(item.stars)}</span>` : ''}</h3>
    ${item.url ? `<p class="paper-url">${esc(item.url)}</p>` : ''}
    <ul>${item.lines.map((line, index) => editing
      ? `<li><input class="paper-edit" data-work-title="${esc(item.rawTitle)}" data-work-line="${index}" value="${esc(line)}"></li>`
      : `<li>${esc(line)}</li>`).join('')}</ul>
  </section>`
}

function sectionHtml(section, esc, editing) {
  if (section.kind === 'lines') {
    return `${sectionTitle(section.title, esc)}<ul class="paper-education">${section.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`
  }
  if (section.kind === 'skills') {
    return `${sectionTitle(section.title, esc)}<p class="paper-skills">${esc(section.text)}</p>`
  }
  return `${sectionTitle(section.title, esc)}${section.projects.map((item) => projectBlock(item, esc, { editing: editing && section.editable })).join('')}`
}

export function renderPaperHtml(resume, esc, { editing = false, nameTag = 'h2' } = {}) {
  const doc = resumeOutline(resume)
  if (!doc) return ''
  const contact = doc.contact.map((item) => `<span>${esc(item)}</span>`).join('')
  return `<article class="paper paper-classic">
    <div class="paper-header-band">
      ${doc.example ? `<p class="paper-eyebrow">${esc(doc.exampleLabel)}</p>` : ''}
      <${nameTag} class="paper-name">${esc(doc.name)}</${nameTag}>
      ${contact ? `<p class="paper-contact">${contact}</p>` : ''}
    </div>
    <div class="paper-body">
      ${doc.headline || doc.summary ? `<div class="paper-intro">${doc.headline ? `<p class="paper-line">${esc(doc.headline)}</p>` : ''}${doc.summary ? `<p class="paper-summary">${esc(doc.summary)}</p>` : ''}</div>` : ''}
      ${doc.sections.map((section) => sectionHtml(section, esc, editing)).join('')}
      ${doc.liveUrl ? `<p class="paper-url">${esc(doc.liveUrl)}</p>` : ''}
    </div>
  </article>`
}
