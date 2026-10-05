/**
 * Validate walkthrough steps. Writes recordings/walkthrough-audit.json
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { BASE_DEFAULT, runWalkthrough, settleUrl } from './walkthrough-steps.mjs'

const BASE = (process.env.BASE || BASE_DEFAULT).replace(/\/$/, '')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(20000)
page.setDefaultNavigationTimeout(35000)
await page.addInitScript(() => {
  window.__e = []
  window.addEventListener('error', (e) => window.__e.push(e.message))
})

const log = await runWalkthrough(page, BASE)
const errors = await page.evaluate(() => window.__e || [])
const report = log.map((entry) => ({ ...entry, errors }))
await mkdir('recordings', { recursive: true })
await writeFile('recordings/walkthrough-audit.json', `${JSON.stringify(report, null, 2)}\n`)
const bad = report.filter((r) => r.issues?.length)
console.log(bad.length ? `ISSUES: ${JSON.stringify(bad, null, 2)}` : 'OK', `(${report.length} steps)`)
await browser.close()
process.exit(bad.length ? 1 : 0)
