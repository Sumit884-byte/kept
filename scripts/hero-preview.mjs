/** Landing hero at 1440×900 (after local design). */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { copy } from '../src/copy.js'
import { exampleResume } from '../src/example.js'
import { escapeHtml } from '../src/escape.js'
import { renderPaperHtml } from '../src/public/paperHtml.js'

const WIDTH = Number(process.env.LAYOUT_WIDTH || 1440)
const HEIGHT = Number(process.env.LAYOUT_HEIGHT || 900)
const OUT = path.resolve(process.env.HERO_PREVIEW_OUT || 'recordings/hero-landing-after.png')
const css = await readFile('src/public/styles.css', 'utf8')
const paperPagesJs = await readFile('src/public/paperPages.js', 'utf8')

const resume = exampleResume()
resume.example = true
const paper = renderPaperHtml(resume, escapeHtml)

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,640&family=Public+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>${css}</style>
<style>
  body { min-height: ${HEIGHT}px; }
  .top nav { margin-left: auto; }
  .top nav a { color: var(--muted); text-decoration: none; margin-right: 1rem; }
  .top nav .button { padding: 0.55rem 1rem; font-size: 0.95rem; }
</style></head><body>
<header class="top">
  <a class="mark" href="/"><img class="mark-icon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231f6a4a'/%3E%3C/svg%3E" alt="">Kept</a>
  <nav><a href="/sign-in">Log in</a><a class="button" href="/sign-in">Sign in</a></nav>
</header>
<main id="main">
<section class="hero">
  <div>
    <p class="eyebrow">${escapeHtml(copy.home.eyebrow)}</p>
    <h1>${escapeHtml(copy.home.title)}</h1>
    <p class="lede">${escapeHtml(copy.home.lede)}</p>
    <div class="actions">
      <a class="button" href="/start">${escapeHtml(copy.home.make)}</a>
      <a class="secondary button" href="/sample">${escapeHtml(copy.home.example)}</a>
    </div>
    <ol class="steps">${copy.home.steps.map((step) => `<li><strong>${escapeHtml(step.n)}</strong><div><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.body)}</span></div></li>`).join('')}</ol>
    <p class="quiet trust">${escapeHtml(copy.home.trust)}</p>
  </div>
  <div class="stage hero-stage">
    <div class="paper-back" aria-hidden="true"></div>
    <div class="paper-frame hero-paper" data-paper-root>${paper}</div>
  </div>
</section>
</main>
<script type="module">
${paperPagesJs.replace('export function layoutPaperPages', 'function layoutPaperPages').replace('export function schedulePaperLayout', 'function schedulePaperLayout')}
/* hero keeps one sheet — pagination skipped for .hero-stage */
</script>
</body></html>`

await mkdir(path.dirname(OUT), { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
await page.setContent(html, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(250)
await page.locator('.hero').screenshot({ path: OUT })
await browser.close()
console.log(`Wrote ${OUT}`)
