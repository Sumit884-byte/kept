/**
 * Capture layout at a fixed viewport (default 1440×900):
 *   1. Public sample resume page
 *   2. After following "Open the PDF"
 *
 * Usage:
 *   npm run layout:screenshots
 *   LAYOUT_BASE_URL=http://localhost:3000 npm run layout:screenshots
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const WIDTH = Number(process.env.LAYOUT_WIDTH || 1440)
const HEIGHT = Number(process.env.LAYOUT_HEIGHT || 900)
const BASE = (process.env.LAYOUT_BASE_URL || 'https://kept-virid-two.vercel.app').replace(/\/$/, '')
const OUT = path.resolve(process.env.LAYOUT_OUT || 'recordings')
const tag = `${WIDTH}x${HEIGHT}`

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

const log = []
function note(line) {
  log.push(line)
  console.log(line)
}

note(`Viewport ${tag}`)
note(`Base ${BASE}`)

await page.goto(`${BASE}/sample`, { waitUntil: 'networkidle', timeout: 60000 })
const pagePath = path.join(OUT, `layout-${tag}-sample-page.png`)
await page.screenshot({ path: pagePath, fullPage: true })
note(`Wrote ${pagePath}`)

const openPdf = page.getByRole('link', { name: /open the pdf/i })
await openPdf.waitFor({ state: 'visible', timeout: 15000 })
const href = await openPdf.getAttribute('href')
if (!href) throw new Error('Open the PDF link has no href')

const pdfUrl = new URL(href, BASE).href
const pdfResponse = await context.request.get(pdfUrl)
if (!pdfResponse.ok()) throw new Error(`PDF fetch failed: ${pdfResponse.status()} ${pdfUrl}`)
const pdfBytes = await pdfResponse.body()
const pdfFile = path.join(OUT, `layout-${tag}-sample.pdf`)
await writeFile(pdfFile, pdfBytes)
note(`Wrote ${pdfFile}`)

const PDF_FIXTURE = 'https://kept-layout.test/sample.pdf'
await context.route(PDF_FIXTURE, (route) => route.fulfill({
  status: 200,
  contentType: 'application/pdf',
  body: pdfBytes,
}))

const pdfPage = await context.newPage()
await pdfPage.setViewportSize({ width: WIDTH, height: HEIGHT })
await pdfPage.setContent(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>PDF preview</title>
<style>
  html, body { margin: 0; background: #525659; }
  #wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 24px; box-sizing: border-box; min-height: 100vh; }
  canvas { background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,0.35); max-width: 100%; height: auto; }
  #err { color: #fff; font: 14px system-ui, sans-serif; padding: 24px; }
</style>
</head><body><div id="wrap"><p id="err">Loading PDF…</p></div>
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
  const page = await doc.getPage(n)
  const scale = Math.min(2, pageWidth / page.getViewport({ scale: 1 }).width)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  wrap.appendChild(canvas)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
}
</script></body></html>`, { waitUntil: 'load', timeout: 120000 })
await pdfPage.waitForFunction(() => !document.querySelector('#err'), { timeout: 120000 })
const pdfPath = path.join(OUT, `layout-${tag}-after-open-pdf.png`)
await pdfPage.screenshot({ path: pdfPath, fullPage: true })
note(`Wrote ${pdfPath} (PDF pages from "Open the PDF" link)`)

await writeFile(path.join(OUT, `layout-${tag}-log.txt`), `${log.join('\n')}\n`, 'utf8')
await browser.close()
