/**
 * Full Kept walkthrough video (~2:40). CDP uses your Brave profile (no in-browser video — use brave:demo for PNG+mp4).
 * Usage: npm run demo:record
 *        npm run demo:record:brave  (CDP — runs steps only, see brave-walkthrough.mjs for slideshow)
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright'
import { BASE_DEFAULT, runWalkthrough } from './walkthrough-steps.mjs'

const CDP = process.env.CDP || ''
const BASE = (process.env.BASE || BASE_DEFAULT).replace(/\/$/, '')
const OUT_DIR = path.resolve(process.env.OUT || 'recordings/brave-walkthrough')
const VIEWPORT = { width: 1440, height: 900 }
const OUT_MP4 = path.join(OUT_DIR, CDP ? 'kept-walkthrough-steps.json' : 'kept-walkthrough-full.mp4')

async function ffmpegFromWebm(webm, mp4) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      'ffmpeg',
      ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4],
      { stdio: 'inherit' },
    )
    ff.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}`))))
  })
}

await mkdir(OUT_DIR, { recursive: true })

let browser
let context
let page

if (CDP) {
  const r = await fetch(`${CDP}/json/version`)
  if (!r.ok) throw new Error(`CDP not ready at ${CDP}`)
  browser = await chromium.connectOverCDP(CDP)
  context = browser.contexts()[0] || (await browser.newContext())
  page = context.pages().find((p) => p.url().startsWith('http')) || context.pages()[0]
  if (!page) page = await context.newPage()
  await page.setViewportSize(VIEWPORT)
  console.log('Running walkthrough steps via Brave CDP')
  const log = await runWalkthrough(page, BASE)
  await writeFile(OUT_MP4, `${JSON.stringify(log, null, 2)}\n`)
  console.log('Wrote step log', OUT_MP4)
  browser.disconnect()
  process.exit(0)
}

browser = await chromium.launch({ headless: true })
context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: OUT_DIR, size: VIEWPORT },
})
page = await context.newPage()

console.log('Recording headless walkthrough')
const log = await runWalkthrough(page, BASE)
const videoPath = await page.video().path()
await context.close()
await browser.close()

const mp4Path = path.join(OUT_DIR, 'kept-walkthrough-full.mp4')
console.log('webm', videoPath)
await ffmpegFromWebm(videoPath, mp4Path)

await writeFile(path.join(OUT_DIR, 'walkthrough-log.json'), `${JSON.stringify(log, null, 2)}\n`)
await writeFile(path.join(OUT_DIR, 'recording-meta.json'), `${JSON.stringify({ base: BASE, out: mp4Path, recordedAt: new Date().toISOString(), steps: log.length }, null, 2)}\n`)
console.log('Wrote', mp4Path)
