/**
 * Brave Default profile walkthrough: PNG frames + slideshow MP4 (requires CDP).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright'
import {
  BASE_DEFAULT,
  TIMING,
  waitForSample,
  waitForStudio,
  gotoApp,
  spaClick,
  enterGuest,
  leaveGuest,
  settleUrl,
} from './walkthrough-steps.mjs'

const CDP = process.env.CDP || 'http://127.0.0.1:9222'
const BASE = (process.env.BASE || BASE_DEFAULT).replace(/\/$/, '')
const OUT_DIR = path.resolve(process.env.OUT || 'recordings/brave-walkthrough')
const VIEWPORT = { width: 1440, height: 900 }
const PAUSE = TIMING

async function waitForCdp(url, ms = 120000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(`${url}/json/version`)
      if (r.ok) return await r.json()
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(
    `No CDP at ${url}. In Brave open chrome://inspect/#remote-debugging and enable remote debugging.`,
  )
}

async function shot(page, name, caption) {
  await settleUrl(page)
  const file = path.join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return { file, caption, url: page.url(), title: await page.title().catch(() => '') }
}

function ffmpegSlideshow(frames, outMp4) {
  return new Promise((resolve, reject) => {
    const listPath = path.join(OUT_DIR, 'ffmpeg-list.txt')
    const lines = frames.flatMap((f) => [
      `file '${f.file.replace(/'/g, "'\\''")}'`,
      `duration ${(f.durationMs / 1000).toFixed(2)}`,
    ])
    lines.push(`file '${frames.at(-1).file.replace(/'/g, "'\\''")}'`)
    writeFile(listPath, `${lines.join('\n')}\n`).then(() => {
      const ff = spawn(
        'ffmpeg',
        [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-vf',
          'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          outMp4,
        ],
        { stdio: 'inherit' },
      )
      ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))))
    })
  })
}

await mkdir(OUT_DIR, { recursive: true })
console.log('Waiting for Brave CDP…', CDP)
await waitForCdp(CDP)

const browser = await chromium.connectOverCDP(CDP)
const context = browser.contexts()[0] || (await browser.newContext())
let page = context.pages().find((p) => p.url().startsWith('http')) || context.pages()[0]
if (!page) page = await context.newPage()
await page.setViewportSize(VIEWPORT)

const frames = []

const step = async (id, caption, fn, durationMs = PAUSE.beat) => {
  console.log('→', id, caption)
  await fn()
  frames.push({ ...(await shot(page, id, caption)), durationMs })
}

await step('01-home', 'Landing: hero resume + Make a link / Try as guest', async () => {
  await gotoApp(page, BASE, '/')
  await page.waitForTimeout(PAUSE.hero)
}, PAUSE.hero)

await step('02-sample', 'Public sample resume (shareable /sample)', async () => {
  await page.goto(`${BASE}/sample`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForURL(/\/r\/[a-z0-9]+/, { timeout: 25000 }).catch(() => {})
  await waitForSample(page)
  await page.waitForTimeout(PAUSE.sample)
}, PAUSE.sample)

await step('03-guest', 'Try as guest → studio with sample projects', async () => {
  await gotoApp(page, BASE, '/')
  await enterGuest(page, BASE, PAUSE)
}, PAUSE.guest)

await step('04-studio', 'Studio: shape this version', async () => {
  await waitForStudio(page)
  await page.waitForTimeout(PAUSE.beat)
}, PAUSE.beat)

await step('05-links', 'SPA: Your links', async () => {
  await spaClick(page, 'nav a[href="/links"]', PAUSE)
}, PAUSE.nav)

await step('06-studio', 'SPA: New link → studio', async () => {
  await spaClick(page, 'nav a[href="/studio"]', PAUSE)
  await waitForStudio(page)
}, PAUSE.nav)

await step('07-start', 'Connect GitHub entry (/start)', async () => {
  await gotoApp(page, BASE, '/start')
  await page.waitForTimeout(PAUSE.beat)
}, PAUSE.beat)

await step('08-signed-out', 'Leave guest mode → signed-out nav', async () => {
  await leaveGuest(page, PAUSE)
}, PAUSE.nav)

await step('09-sign-in', 'Sign in (full page, Clerk)', async () => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('#main h1', { timeout: 15000 })
  await settleUrl(page)
  await page.waitForTimeout(PAUSE.auth)
}, PAUSE.auth)

await step('10-guard', 'Protected /studio → sign-in with ?next=', async () => {
  await gotoApp(page, BASE, '/studio')
  await page.waitForTimeout(PAUSE.beat)
}, PAUSE.beat)

await step('11-missing', '404-style missing page', async () => {
  await gotoApp(page, BASE, '/nope')
  await page.waitForTimeout(PAUSE.beat)
}, PAUSE.beat)

await step('12-home', 'Back home via SPA', async () => {
  const home = page.locator('a[data-go="/"]')
  if (await home.count()) await spaClick(page, 'a[data-go="/"]', PAUSE)
  else await gotoApp(page, BASE, '/')
  await page.waitForTimeout(PAUSE.hero)
}, PAUSE.hero)

const totalMs = frames.reduce((s, f) => s + f.durationMs, 0)
const outMp4 = path.join(OUT_DIR, 'kept-walkthrough.mp4')
const narration = `# Kept walkthrough (Brave Default profile)

**Production:** ${BASE}  
**Recorded:** ${new Date().toISOString()}  
**Runtime:** ~${(totalMs / 1000 / 60).toFixed(1)} min (${(totalMs / 1000).toFixed(0)}s)  
**Video:** \`recordings/brave-walkthrough/kept-walkthrough.mp4\`

## Slides

${frames
  .map((f, i) => {
    const t = frames.slice(0, i).reduce((s, x) => s + x.durationMs, 0) / 1000
    const mm = String(Math.floor(t / 60)).padStart(2, '0')
    const ss = String(Math.floor(t % 60)).padStart(2, '0')
    return `### ${mm}:${ss} — ${f.caption}\n\n![${f.caption}](${path.basename(f.file)})\n`
  })
  .join('\n')}
`

await writeFile(path.join(OUT_DIR, 'WALKTHROUGH.md'), narration)
await writeFile(path.join(OUT_DIR, 'frames.json'), `${JSON.stringify(frames, null, 2)}\n`)

try {
  await ffmpegSlideshow(frames, outMp4)
  console.log('Wrote', outMp4)
} catch (e) {
  console.warn('ffmpeg slideshow skipped:', e.message)
}

console.log('Done. See', path.join(OUT_DIR, 'WALKTHROUGH.md'))
browser.disconnect()
