/**
 * Audit Kept navigation routes at 1440×900.
 * Usage: BASE=https://kept-virid-two.vercel.app node scripts/nav-audit.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE = (process.env.BASE || 'https://kept-virid-two.vercel.app').replace(/\/$/, '')

async function waitApp(page) {
  await page.waitForFunction(
    () => document.querySelector('nav') || document.querySelector('#main h1'),
    { timeout: 20000 },
  ).catch(() => {})
  await page.waitForTimeout(800)
}

async function readState(page) {
  return page.evaluate(() => ({
    path: location.pathname + location.search,
    h1: document.querySelector('#main h1')?.innerText?.trim() || '',
    nav: document.querySelector('nav')?.innerText?.trim().replace(/\s+/g, ' | ') || '',
    banner: document.querySelector('.banner')?.innerText?.trim() || '',
    guestBanner: Boolean(document.querySelector('.guest-banner')),
    errors: window.__navErrors || [],
  }))
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await waitApp(page)
  return readState(page)
}

async function spaClick(page, selector) {
  const before = await page.evaluate(() => location.pathname)
  await page.click(selector, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => location.pathname)
  return { before, after, ...(await readState(page)) }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.addInitScript(() => {
  window.__navErrors = []
  window.addEventListener('error', (e) => window.__navErrors.push(`error:${e.message}`))
  window.addEventListener('unhandledrejection', (e) => window.__navErrors.push(`rej:${e.reason?.message || e.reason}`))
})

const report = []

report.push({ step: 'GET /', ...(await goto(page, '/')) })
report.push({ step: 'GET /start', ...(await goto(page, '/start')) })
report.push({ step: 'GET /sign-in', ...(await goto(page, '/sign-in')) })
report.push({ step: 'GET /join', ...(await goto(page, '/join')) })
report.push({ step: 'GET /studio (signed out)', ...(await goto(page, '/studio')) })
report.push({ step: 'GET /links (signed out)', ...(await goto(page, '/links')) })
report.push({ step: 'GET /missing', ...(await goto(page, '/nope')) })

await goto(page, '/')
await goto(page, '/sample')
await page.waitForSelector('.paper-name', { timeout: 15000 }).catch(() => {})
report.push({
  step: 'GET /sample content',
  ...(await readState(page)),
  sampleName: await page.locator('.paper-name').first().innerText().catch(() => ''),
})
await goto(page, '/')
await page.click('button[data-action=guest]', { timeout: 15000 }).catch(async () => {
  await page.click('text=Try as guest', { timeout: 5000 }).catch(() => {})
})
await page.waitForTimeout(2500)
report.push({ step: 'guest → studio', ...(await readState(page)) })

report.push({ step: 'GET /links (guest)', ...(await goto(page, '/links')) })
report.push({ step: 'SPA nav New link', ...(await spaClick(page, 'nav a[href="/studio"]')) })
report.push({ step: 'SPA nav Your links', ...(await spaClick(page, 'nav a[href="/links"]')) })
report.push({ step: 'SPA logo home', ...(await spaClick(page, 'a.mark')) })

await goto(page, '/studio')
const connect = await page.$('.guest-connect')
if (connect) {
  await Promise.all([
    page.waitForURL(/github\.com/, { timeout: 15000 }).catch(() => {}),
    connect.click(),
  ])
  report.push({
    step: 'guest Connect GitHub',
    path: page.url(),
    githubOAuth: page.url().includes('github.com'),
    ...(await readState(page).catch(() => ({}))),
  })
  await page.goto(`${BASE}/studio`, { waitUntil: 'domcontentloaded' })
  await waitApp(page)
}

report.push({ step: 'guest GET /start', ...(await goto(page, '/start')) })
report.push({ step: 'guest GET /sign-in (redirect studio)', ...(await goto(page, '/sign-in')) })

await goto(page, '/studio')
await page.click('nav a[href="/links"]')
await page.waitForTimeout(800)
await page.goBack()
await page.waitForTimeout(1200)
report.push({ step: 'browser back from links', ...(await readState(page)) })

await page.click('button[data-action=logout]', { timeout: 8000 }).catch(() => {})
await page.waitForTimeout(1500)
report.push({ step: 'logout → home', ...(await readState(page)) })

await browser.close()

await mkdir('recordings', { recursive: true })
await writeFile('recordings/nav-audit.json', `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
console.log('\n--- summary ---')
for (const row of report) {
  const err = (row.errors || []).length ? ` ERR:${row.errors.join(';')}` : ''
  const warn = row.banner ? ` BANNER:${row.banner}` : ''
  console.log(`${row.step}: ${row.path || ''} h1="${row.h1 || ''}" nav="${row.nav || ''}"${err}${warn}`)
}
process.exitCode = report.some((r) => (r.errors || []).length) ? 1 : 0
