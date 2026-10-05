/** Render example resume PDF to a PNG (1440×900 canvas). */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { exampleResume } from '../src/example.js'
import { renderPdf } from '../src/pdf.js'

const WIDTH = Number(process.env.LAYOUT_WIDTH || 1440)
const HEIGHT = Number(process.env.LAYOUT_HEIGHT || 900)
const OUT = path.resolve(process.env.PDF_PREVIEW_OUT || 'recordings/pdf-look-after.png')

const pdfBytes = await renderPdf(exampleResume())
await mkdir(path.dirname(OUT), { recursive: true })

const PDF_FIXTURE = 'https://kept-layout.test/preview.pdf'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })
await context.route(PDF_FIXTURE, (route) => route.fulfill({
  status: 200,
  contentType: 'application/pdf',
  body: pdfBytes,
}))

const page = await context.newPage()
await page.setContent(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>PDF</title>
<style>
  html, body { margin: 0; background: #525659; }
  #wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 24px; min-height: 100vh; box-sizing: border-box; }
  canvas { background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,0.35); max-width: 100%; }
</style></head><body><div id="wrap"><p id="wait">Loading…</p></div>
<script type="module">
import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs'
const res = await fetch(${JSON.stringify(PDF_FIXTURE)})
const bytes = new Uint8Array(await res.arrayBuffer())
const doc = await pdfjs.getDocument({ data: bytes }).promise
const wrap = document.getElementById('wrap')
wrap.innerHTML = ''
const pageWidth = ${WIDTH} - 48
for (let n = 1; n <= doc.numPages; n += 1) {
  const p = await doc.getPage(n)
  const scale = Math.min(2, pageWidth / p.getViewport({ scale: 1 }).width)
  const viewport = p.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  wrap.appendChild(canvas)
  await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
}
</script></body></html>`, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => !document.querySelector('#wait'), { timeout: 120000 })
await page.screenshot({ path: OUT, fullPage: true })
await browser.close()
console.log(`Wrote ${OUT}`)
