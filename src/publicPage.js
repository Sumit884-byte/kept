import { copy } from './copy.js'
import { escapeHtml } from './escape.js'
import { renderPaperHtml } from './paperHtml.js'

function page({ title, body, statusNote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" href="/styles.css" as="style">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,640&amp;family=Public+Sans:ital,wght@0,400;0,560;1,400&amp;display=swap">
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
  const paper = renderPaperHtml(resume, escapeHtml, { nameTag: 'h1' })
  return page({
    title: resume.name,
    statusNote: copy.public.stays,
    body: `
      <div class="paper-column public-paper-wrap">
        <div class="paper-tools public-paper-tools">
          <a class="icon-button" href="/r/${escapeHtml(link.slug)}.pdf" download aria-label="${escapeHtml(copy.public.download)}" title="${escapeHtml(copy.public.download)}"><svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg></a>
        </div>
      ${paper.replace('class="paper paper-classic"', 'class="paper paper-classic public-paper"')}
      </div>
      <p class="public-actions"><a class="button" href="/r/${escapeHtml(link.slug)}.pdf" target="_blank" rel="noopener">${escapeHtml(copy.public.open)}</a></p>`,
  })
}
