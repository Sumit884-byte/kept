/** Render example resume HTML (classic template) to PNG at 1440×900. */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { exampleResume } from '../src/example.js'
import { escapeHtml } from '../src/escape.js'
import { renderPaperHtml } from '../src/public/paperHtml.js'
import { copy } from '../src/copy.js'

const WIDTH = Number(process.env.LAYOUT_WIDTH || 1440)
const HEIGHT = Number(process.env.LAYOUT_HEIGHT || 900)
const OUT = path.resolve(process.env.HTML_PREVIEW_OUT || 'recordings/layout-sample-after.png')
const stylesPath = path.resolve('src/public/styles.css')
const css = await readFile(stylesPath, 'utf8')

const paper = renderPaperHtml(exampleResume(), escapeHtml, { nameTag: 'h1' })
  .replace('class="paper paper-classic"', 'class="paper paper-classic public-paper"')

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,640&family=Public+Sans:ital,wght@0,400;0,560;1,400&display=swap" rel="stylesheet">
<style>${css}</style>
<style>
  body { margin: 0; background: var(--bg, #e8e2d8); }
  main.public-main { max-width: none; padding: 2rem 1.5rem 3rem; }
</style></head><body><main class="public-main" id="main">
<p class="mark public-mark"><img class="mark-icon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231f6a4a'/%3E%3C/svg%3E" alt="">${escapeHtml(copy.name)}</p>
<div class="paper-column public-paper-wrap"><div class="paper-tools public-paper-tools"></div>${paper}</div>
</main></body></html>`

await mkdir(path.dirname(OUT), { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
await page.setContent(html, { waitUntil: 'networkidle', timeout: 60000 })
await page.screenshot({ path: OUT, fullPage: true })
await browser.close()
console.log(`Wrote ${OUT}`)
