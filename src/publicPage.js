import { copy } from './copy.js'
import { escapeHtml } from './escape.js'
import { starLabel } from './resume.js'

function page({ title, body, statusNote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,640&family=Public+Sans:ital,wght@0,400;0,560;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="public-main" id="main">
    <p class="mark public-mark"><img class="mark-icon" src="/favicon.svg" alt="">${escapeHtml(copy.name)}</p>
    ${body}
    <p class="quiet">${escapeHtml(statusNote || '')}</p>
  </main>
</body>
</html>`
}

export function renderPublicPage(link) {
  if (!link) {
    return page({
      title: copy.public.missing,
      body: `<h1>${escapeHtml(copy.public.missing)}</h1><p><a href="/">${escapeHtml(copy.public.home)}</a></p>`,
    })
  }
  const resume = link.resume
  if (!resume) {
    return page({
      title: copy.public.preparingTitle,
      body: `<h1>${escapeHtml(copy.public.preparing)}</h1><p>${escapeHtml(copy.public.tryAgain)}</p>`,
    })
  }
  const contact = (resume.contact || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')
  const work = (resume.work || []).map((item) => `
    <section class="paper-role">
      <h3>${escapeHtml(item.title)}${item.stars > 0 ? `<span class="star-count">${escapeHtml(starLabel(item.stars))}</span>` : ''}</h3>
      ${item.url ? `<p class="paper-url">${escapeHtml(item.url)}</p>` : ''}
      <ul>${(item.lines || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    </section>`).join('')
  return page({
    title: resume.name,
    statusNote: copy.public.stays,
    body: `
      <article class="paper public-paper">
        <h1 class="paper-name">${escapeHtml(resume.name)}</h1>
        ${contact ? `<p class="paper-contact">${contact}</p>` : ''}
        ${resume.headline ? `<p class="paper-line">${escapeHtml(resume.headline)}</p>` : ''}
        ${resume.summary ? `<p class="paper-summary">${escapeHtml(resume.summary)}</p>` : ''}
        ${(resume.education || []).length ? `<h2>${escapeHtml(copy.pdf.education)}</h2><ul class="paper-education">${resume.education.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
        ${resume.skills?.length ? `<h2>${escapeHtml(copy.pdf.skills)}</h2><p class="paper-skills">${escapeHtml(resume.skills.join(', '))}</p>` : ''}
        ${work ? `<h2>${escapeHtml(copy.pdf.selectedWork)}</h2>${work}` : ''}
        ${(resume.contributions || []).length ? `<h2>${escapeHtml(copy.pdf.contributions)}</h2>${(resume.contributions || []).map((item) => `<section class="paper-role"><h3>${escapeHtml(item.title || '')}</h3>${item.url ? `<p class="paper-url">${escapeHtml(item.url)}</p>` : ''}<ul><li>${escapeHtml(item.line)}</li></ul></section>`).join('')}` : ''}
      </article>
      <p class="public-actions"><a class="button" href="/r/${escapeHtml(link.slug)}.pdf">${escapeHtml(copy.public.open)}</a></p>`,
  })
}
