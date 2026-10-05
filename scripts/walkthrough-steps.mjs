/**
 * Shared waits + ordered steps for Kept product walkthroughs.
 */
export const BASE_DEFAULT = 'https://kept-virid-two.vercel.app'

const FAST = process.env.WALKTHROUGH_FAST === '1'

export const TIMING = FAST
  ? { hero: 900, sample: 1200, beat: 900, nav: 900, guest: 1200, auth: 900 }
  : { hero: 2800, sample: 3500, beat: 2400, nav: 2200, guest: 3200, auth: 2800 }

export async function waitForBoot(page) {
  await page
    .waitForFunction(
      () => {
        const guest = document.querySelector('button[data-action=guest]')
        const hero = document.querySelector('.hero-stage .paper-name, .hero-paper .paper-name')
        const signedNav = document.querySelector('nav button[data-action=logout]')
        const h1 = document.querySelector('#main h1')
        const auth = document.querySelector('#clerk-auth, .auth-form, form#auth-form')
        return guest || hero || signedNav || h1 || auth
      },
      { timeout: 30000 },
    )
    .catch(() => {})
  await settleUrl(page)
  await page.waitForTimeout(400)
}

export async function settleUrl(page) {
  await page
    .waitForFunction(
      () => !location.search.includes('__clerk_handshake') && !location.search.includes('__clerk_db_jwt'),
      { timeout: FAST ? 4000 : 8000 },
    )
    .catch(() => {})
}

export async function waitForSample(page) {
  await page.waitForURL(/\/r\/[a-z0-9]+/, { timeout: 25000 }).catch(() => {})
  await page.waitForSelector('.paper-name', { state: 'visible', timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(400)
}

export async function waitForStudio(page) {
  await page.waitForSelector('#main h1', { timeout: 20000 }).catch(() => {})
  await page
    .waitForFunction(
      () => {
        const h1 = document.querySelector('#main h1')?.textContent || ''
        if (!/shape this version/i.test(h1)) return true
        return (
          document.querySelector('.guest-banner') ||
          document.querySelector('#editor input[name=repo]') ||
          document.querySelector('#editor .project')
        )
      },
      { timeout: 25000 },
    )
    .catch(() => {})
  await page.waitForTimeout(400)
}

export async function gotoApp(page, base, route) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (route === '/' || route.startsWith('/studio') || route.startsWith('/links') || route === '/start') {
    await waitForBoot(page)
  }
  if (route === '/sample') await waitForSample(page)
  if (route === '/sign-in' || route === '/join') {
    await page.waitForSelector('#main h1, #clerk-auth', { timeout: 20000 }).catch(() => {})
    await settleUrl(page)
  }
}

export async function spaClick(page, selector, timing = TIMING) {
  await page.click(selector, { timeout: 12000 })
  await page.waitForTimeout(timing.nav)
  await settleUrl(page)
}

export async function enterGuest(page, base, timing = TIMING) {
  await page.waitForSelector('button[data-action=guest]', { timeout: 15000 })
  await page.click('button[data-action=guest]')
  await page.waitForTimeout(1200)
  const reachedStudio = await page
    .waitForURL(/\/studio/, { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  if (!reachedStudio) {
    const onSignIn = page.url().includes('/sign-in')
    if (onSignIn) {
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
      await page.click('button[data-action=guest]').catch(() => {})
      await page.waitForURL(/\/studio/, { timeout: 15000 }).catch(() => {})
    }
    await page.goto(`${base}/studio`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitForBoot(page)
  }
  await waitForStudio(page)
  await page.waitForTimeout(timing.guest)
}

export async function leaveGuest(page, timing = TIMING) {
  const btn = page.locator('button[data-action=logout]')
  if (!(await btn.count())) return false
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/guest') && r.url().includes('action=leave') && r.ok(), { timeout: 15000 }).catch(() => {}),
    btn.first().click({ timeout: 8000 }),
  ])
  await page.waitForFunction(
    () => !document.querySelector('nav button[data-action=logout]'),
    { timeout: 12000 },
  ).catch(() => {})
  await page.waitForTimeout(timing.nav)
  return true
}

/** Ordered demo (~2:40). Returns step log for audits. */
export async function runWalkthrough(page, base, timing = TIMING) {
  const log = []
  const note = async (step, fn) => {
    console.log('walkthrough:', step)
    await fn()
    const path = new URL(page.url()).pathname + new URL(page.url()).search
    const h1 = await page.locator('#main h1').first().innerText().catch(() => '')
    const paper = await page.locator('.paper-name').first().innerText().catch(() => '')
    const issues = []
    if (path.includes('__clerk_handshake') || path.includes('__clerk_db_jwt')) issues.push('clerk_noise_in_url')
    if (step === 'sample' && !paper) issues.push('missing_paper_name')
    if (step === 'sample' && !path.includes('/r/')) issues.push('sample_not_public_page')
    if (step === 'sign-in' && path.includes('/studio')) issues.push('sign_in_skipped_while_guest')
    if (step === 'guard-studio' && !path.includes('/sign-in')) issues.push('studio_guard_missing')
    log.push({ step, path, h1, paper, issues })
  }

  await note('home', async () => {
    await gotoApp(page, base, '/')
    await page.waitForTimeout(timing.hero)
  })

  await note('sample', async () => {
    await page.goto(`${base}/sample`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForURL(/\/r\/[a-z0-9]+/, { timeout: 25000 }).catch(() => {})
    await waitForSample(page)
    if (!(await page.locator('.paper-name').count())) {
      await gotoApp(page, base, '/')
      await page.waitForSelector('.hero-stage .paper-name, .hero-paper .paper-name', { timeout: 15000 }).catch(() => {})
    }
    await page.waitForTimeout(timing.sample)
  })

  await note('home-again', async () => {
    await gotoApp(page, base, '/')
    await page.waitForTimeout(timing.beat)
  })

  await note('guest-studio', async () => {
    await enterGuest(page, base, timing)
  })

  await note('spa-links', async () => {
    await spaClick(page, 'nav a[href="/links"]', timing)
    await page.waitForSelector('#main h1', { timeout: 10000 })
  })

  await note('spa-studio', async () => {
    await spaClick(page, 'nav a[href="/studio"]', timing)
    await waitForStudio(page)
  })

  await note('start', async () => {
    await gotoApp(page, base, '/start')
    await page.waitForTimeout(timing.beat)
  })

  await note('leave-guest', async () => {
    await leaveGuest(page, timing)
  })

  await note('sign-in', async () => {
    await page.goto(`${base}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#main h1', { timeout: 15000 })
    await settleUrl(page)
    await page.waitForTimeout(timing.auth)
  })

  await note('guard-studio', async () => {
    await gotoApp(page, base, '/studio')
    await page.waitForTimeout(timing.beat)
  })

  await note('missing', async () => {
    await gotoApp(page, base, '/nope')
    await page.waitForTimeout(timing.beat)
  })

  await note('home-logo', async () => {
    await spaClick(page, 'a[data-go="/"]', timing).catch(async () => {
      await gotoApp(page, base, '/')
    })
    await page.waitForTimeout(timing.hero)
  })

  return log
}
