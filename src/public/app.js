import { bindingFromAccount, sameBinding } from './accountBinding.js'
import { copy } from '/copy.js'
import { renderPaperHtml } from './paperHtml.js'
import { fullNamesForRole } from '/rolePick.js'

const BINDING_KEY = 'kept.binding'

const authModule = () => import('./auth.js')
let paperPagesModule = null

function schedulePaperLayout() {
  paperPagesModule ||= import('./paperPages.js?v=preview')
  paperPagesModule.then((mod) => mod.schedulePaperLayout()).catch(() => {})
}

const state = {
  me: null,
  example: null,
  form: null,
  projects: [],
  projectsFor: '',
  projectsLoadedFor: '',
  previewProjectPool: null,
  projectsLoading: false,
  projectsLoadingSince: 0,
  needPrivate: false,
  projectsError: '',
  projectsRetrying: false,
  links: [],
  current: null,
  error: '',
  notice: '',
  busy: false,
  privateBusy: false,
  privateNote: '',
  localTried: new Set(),
  confirmRemove: false,
  watchToken: 0,
  authStep: 'details',
  needGithub: false,
  callbackStarted: false,
  projectsOpen: false,
  fillRepos: false,
  filledFor: '',
  reposTouched: false,
  deselectedRepos: new Set(),
  projectNamesSeen: null,
  editing: false,
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]))
}

function starCount(count) {
  const n = Math.max(0, Math.round(Number(count) || 0))
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'star' : 'stars'}`
}

function parse(pathname) {
  if (pathname === '/') return { name: 'home' }
  if (pathname === '/start') return { name: 'start' }
  if (pathname === '/sign-in') return { name: 'sign-in' }
  if (pathname === '/join') return { name: 'join' }
  if (pathname === '/sso-callback') return { name: 'callback' }
  if (pathname === '/studio') return { name: 'studio' }
  if (pathname === '/links') return { name: 'links' }
  const match = pathname.match(/^\/links\/([0-9a-f-]{36})$/i)
  if (match) return { name: 'detail', id: match[1] }
  return { name: 'missing' }
}

function apiDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function apiRetryable(error, method, options) {
  if (options.noRetry) return false
  const status = Number(error.status) || 0
  if ([401, 403, 404, 409, 422].includes(status)) return false
  if (status === 429 || status >= 500 || status === 0) return true
  if (error.message === copy.errors.generic) return true
  if (method === 'GET' && status === 405) return true
  return false
}

async function apiOnce(path, options = {}) {
  const method = options.method || 'GET'
  const timeoutMs = options.timeoutMs ?? (method === 'GET' ? 28000 : 45000)
  const signal = options.signal
    || (typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined)
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = null
  }
  if (!response.ok || data == null || typeof data !== 'object') {
    const error = new Error(data?.message || copy.errors.generic)
    error.status = response.status
    throw error
  }
  return data
}

let projectsLoadSeq = 0

function currentProjectScope() {
  const editor = document.querySelector('#editor')
  if (editor) {
    return editor.querySelector('input[name="visibility"]:checked')?.value === 'all' ? 'all' : 'public'
  }
  if (new URLSearchParams(location.search).get('visibility') === 'all') return 'all'
  if (state.current?.visibility === 'all') return 'all'
  return state.form?.visibility === 'all' ? 'all' : 'public'
}

function projectsLoadStuck() {
  return state.projectsLoading && Date.now() - (state.projectsLoadingSince || 0) > 32000
}

function guestSampleMode() {
  const account = state.me?.account
  if (!account) return false
  if (account.preview) return true
  return Boolean(state.me?.guest && !account.githubConnected)
}

function rememberPreviewProjects(meOrGuest) {
  if (!meOrGuest?.projects?.length) return
  state.previewProjectPool = meOrGuest.projects
  if (meOrGuest.counts) state.counts = meOrGuest.counts
}

function applyPreviewProjects(visibility) {
  if (!guestSampleMode() || !state.previewProjectPool?.length) return false
  const projects = state.previewProjectPool.filter((project) => visibility === 'all' || !project.private)
  state.projects = projects
  state.counts = {
    public: projects.filter((p) => !p.private).length,
    private: projects.filter((p) => p.private).length,
    forks: projects.filter((p) => p.fork).length,
    all: projects.length,
  }
  state.projectsLoadedFor = visibility
  state.projectsFor = visibility
  state.needPrivate = false
  state.needGithub = false
  state.projectsError = ''
  return true
}

function needsProjectsLoad(scope) {
  if (!state.me?.account) return false
  if (state.projectsError) return false
  if (guestSampleMode() && state.previewProjectPool?.length) return state.projectsLoadedFor !== scope
  if (projectsLoadStuck()) return true
  if (state.projectsLoading) return false
  if (state.projectsLoadedFor !== scope) return true
  return false
}

function maybeLoadProjects() {
  const route = parse(location.pathname)
  if (route.name !== 'studio' && route.name !== 'detail') return
  const scope = currentProjectScope()
  if (guestSampleMode() && state.previewProjectPool?.length && state.projectsLoadedFor === scope) return
  if (!needsProjectsLoad(scope)) return
  if (projectsLoadStuck()) state.projectsLoading = false
  if (guestSampleMode() && state.previewProjectPool?.length && applyPreviewProjects(scope)) {
    state.projectsLoading = false
    state.projectsRetrying = false
    render()
    return
  }
  ensureProjects(scope)
}

async function api(path, options = {}) {
  const method = options.method || 'GET'
  const max = options.noRetry ? 1 : (method === 'GET' ? 5 : 4)
  let lastError
  for (let attempt = 0; attempt < max; attempt += 1) {
    if (attempt > 0) {
      if (!options.quiet) {
        state.notice = copy.errors.stillWorking
        render()
      }
      await apiDelay(Math.min(4000, 350 * (2 ** (attempt - 1))))
    }
    try {
      const data = await apiOnce(path, options)
      if (attempt > 0 && !options.quiet && state.notice === copy.errors.stillWorking) {
        state.notice = ''
        render()
      }
      return data
    } catch (error) {
      lastError = error
      if (!apiRetryable(error, method, options) || attempt === max - 1) {
        if (error.message === copy.errors.generic) {
          error.message = copy.errors.gaveUp
        }
        if (state.notice === copy.errors.stillWorking) {
          state.notice = ''
        }
        throw error
      }
    }
  }
  throw lastError
}

function safeNext() {
  const next = new URLSearchParams(location.search).get('next') || ''
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/api')) return ''
  return next
}

async function refreshMe() {
  try {
    state.me = await apiOnce('/api/me')
    rememberPreviewProjects(state.me)
    return state.me
  } catch {
    return state.me
  }
}

function signInAgainPath() {
  const route = parse(location.pathname)
  const next = route.name === 'detail' ? `/links/${route.id}` : route.name === 'studio' ? '/studio' : location.pathname
  return `/sign-in?next=${encodeURIComponent(next)}`
}

function makePath() {
  const account = state.me?.account
  if (account?.preview || account?.githubConnected) return '/studio'
  if (account) return '/start'
  if (state.me?.signInReady) return `/sign-in?next=${encodeURIComponent('/start')}`
  return '/start'
}

function stripClerkNoiseFromUrl() {
  const url = new URL(location.href)
  if (!url.searchParams.has('__clerk_handshake') && !url.searchParams.has('__clerk_db_jwt')) return
  url.searchParams.delete('__clerk_handshake')
  url.searchParams.delete('__clerk_db_jwt')
  const qs = url.searchParams.toString()
  history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
}

function go(path) {
  history.pushState({}, '', path)
  state.error = ''
  state.notice = path === '/links' ? state.notice : ''
  state.confirmRemove = false
  state.editing = false
  state.authStep = 'details'
  if (path === '/studio' || path === '/links' || path.startsWith('/links/')) {
    import('/rolePick.js').catch(() => {})
  }
  if (path === '/studio') {
    state.form = blankForm(state.me?.account)
    state.projectsOpen = false
    state.filledFor = ''
    state.reposTouched = false
    state.fillRepos = true
    state.current = null
    state.editing = false
    if (guestSampleMode()) {
      rememberPreviewProjects(state.me)
      const vis = state.form.visibility === 'all' ? 'all' : 'public'
      applyPreviewProjects(vis)
      state.projectsLoading = false
      state.projectsRetrying = false
    } else {
      state.projectsFor = ''
      state.projectsLoadedFor = ''
    }
  }
  render()
}

function paper(resume) {
  return renderPaperHtml(resume, esc, { editing: state.editing })
}

function header() {
  const account = state.me?.account
  const leave = account?.preview
    ? copy.nav.guestLeave
    : (account?.clerk ? copy.nav.signOut : copy.nav.disconnect)
  const right = account
    ? `<a href="/links" data-go="/links">${esc(copy.nav.links)}</a>
       <a href="${account.preview || account.githubConnected ? '/studio' : '/start'}" data-go="${account.preview || account.githubConnected ? '/studio' : '/start'}">${esc(copy.nav.newLink)}</a>
       <button type="button" data-action="logout">${esc(leave)}</button>`
    : `<a href="/sign-in" data-go="/sign-in">${esc(copy.nav.login)}</a>
       <a class="button" href="/join" data-go="/join">${esc(copy.nav.signIn)}</a>`
  return `<a class="mark" href="/" data-go="/"><img class="mark-icon" src="/favicon.svg" alt="">${esc(copy.name)}</a><nav>${right}</nav>`
}

function downloadIcon() {
  return `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`
}

function paperDownload(url) {
  return `<a class="icon-button" href="${esc(url)}" download aria-label="${esc(copy.detail.download)}" title="${esc(copy.detail.download)}">${downloadIcon()}</a>`
}

function banner() {
  const params = new URLSearchParams(location.search)
  const notice = params.get('notice')
  const denied = notice === 'denied' ? copy.errors.denied : ''
  const setup = notice === 'setup' ? copy.errors.notReady : ''
  const taken = notice === 'taken' ? copy.auth.taken : ''
  const google = notice === 'google' ? copy.auth.googleFailed : ''
  const message = state.error || denied || setup || taken || google
  const good = state.notice
  return `${message ? `<p class="banner" role="alert">${esc(message)}</p>` : ''}${good ? `<p class="ok" role="status">${esc(good)}</p>` : ''}`
}

function guestBanner() {
  if (!state.me?.account?.preview) return ''
  const connect = state.me?.githubReady
    ? `<a class="guest-connect" href="/api/auth/github?visibility=all">${esc(copy.guest.connectGitHub)}</a>`
    : ''
  return `<p class="guest-banner" role="status">${esc(copy.guest.banner)} ${connect}${connect ? ' · ' : ''}<a href="/join" data-go="/join">${esc(copy.guest.signUp)}</a>.</p>`
}

function guestButton(label = copy.guest.continue) {
  if (state.me?.account) return ''
  if (state.me && !state.me.guest) return ''
  return `<button class="button secondary" type="button" data-action="guest" ${state.busy ? 'disabled' : ''}>${esc(label)}</button>`
}

function viewHome() {
  return `<section class="hero">
    <div>
      <p class="eyebrow">${esc(copy.home.eyebrow)}</p>
      <h1>${esc(copy.home.title)}</h1>
      <p class="lede">${esc(copy.home.lede)}</p>
      <div class="actions">
        <a class="button" href="${makePath()}" data-go="${makePath()}">${esc(copy.home.make)}</a>
        ${guestButton(copy.home.guest)}
        <a class="secondary button" href="/sample">${esc(copy.home.example)}</a>
      </div>
      <ol class="steps">
        ${copy.home.steps.map((step) => `<li><strong>${esc(step.n)}</strong><div><strong>${esc(step.title)}</strong><span>${esc(step.body)}</span></div></li>`).join('')}
      </ol>
      <p class="quiet trust">${esc(copy.home.trust)}</p>
    </div>
    <div class="stage hero-stage">
      <div class="paper-back" aria-hidden="true"></div>
      <div class="paper-frame hero-paper" data-paper-root>${paper(state.example)}</div>
    </div>
  </section>`
}

function viewStart() {
  const tryGuest = guestButton(copy.start.guest)
  const ready = state.me?.githubReady
  const loginFirst = `/sign-in?next=${encodeURIComponent('/start')}`
  const canConnectGithub = Boolean(state.me?.account) || !state.me?.signInReady
  const connect = ready
    ? (canConnectGithub
      ? `<button class="button" type="submit">${esc(copy.start.connect)}</button>`
      : `<a class="button" href="${loginFirst}" data-go="${loginFirst}">${esc(copy.nav.login)}</a>`)
    : `<p class="quiet">${esc(copy.start.notReady)}</p>`
  return `<section class="panel">
    <h1>${esc(copy.start.title)}</h1>
    <p class="lede">${esc(copy.start.lede)}</p>
    <p>${esc(copy.start.publicModel)}</p>
    <p>${esc(copy.start.privateModel)}</p>
    <p>${esc(copy.start.both)}</p>
    ${banner()}
    <form id="start-form">
      <div class="actions">
        ${connect}
        ${tryGuest}
      </div>
    </form>
  </section>`
}

function passwordField(label, autocomplete) {
  return `<label class="field field-password"><span>${esc(label)}</span>
        <span class="password-wrap">
          <input name="password" type="password" autocomplete="${esc(autocomplete)}" required>
          <button type="button" class="password-toggle" data-action="toggle-password" aria-label="${esc(copy.auth.showPassword)}" aria-pressed="false">
            <svg class="icon icon-eye" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            <svg class="icon icon-eye-off" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
          </button>
        </span>
      </label>`
}

function viewAuth() {
  const join = parse(location.pathname).name === 'join'
  const title = join ? copy.auth.signInTitle : copy.auth.loginTitle
  const lede = join ? copy.auth.signInLede : copy.auth.loginLede
  const other = join
    ? `<a href="/sign-in" data-go="/sign-in">${esc(copy.nav.login)}</a>`
    : `<a href="/join" data-go="/join">${esc(copy.nav.signIn)}</a>`
  const switchLine = join
    ? `Already have an account? ${other}`
    : `Don't have an account? ${other}`
  const back = `<p class="auth-switch"><button type="button" class="text-button" data-action="show-login">${esc(copy.auth.backToLogin)}</button></p>`
  if (!state.me?.signInReady) {
    return `<section class="panel auth-panel"><p class="quiet">${esc(copy.auth.notReady)}</p></section>`
  }
  if (state.authStep === 'forgot') {
    return `<section class="panel auth-panel">
      <form id="auth-forgot" class="auth-card">
        <img class="auth-mark" src="/favicon.svg" alt="">
        <h1>${esc(copy.auth.forgotTitle)}</h1>
        <p class="lede">${esc(copy.auth.forgotLede)}</p>
        ${banner()}
        <label class="field"><span>${esc(copy.auth.email)}</span><input name="email" type="email" autocomplete="email" value="${esc(state.resetEmail || '')}" required></label>
        <button class="button auth-submit" type="submit" ${state.busy ? 'disabled' : ''}>${esc(state.busy ? copy.loading : copy.auth.forgotSend)}</button>
        ${back}
      </form>
    </section>`
  }
  if (state.authStep === 'reset') {
    return `<section class="panel auth-panel">
      <form id="auth-reset" class="auth-card">
        <img class="auth-mark" src="/favicon.svg" alt="">
        <h1>${esc(copy.auth.resetTitle)}</h1>
        <p class="lede">${esc(copy.auth.resetLede)}</p>
        ${banner()}
        <label class="field"><span>${esc(copy.auth.code)}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
        ${passwordField(copy.auth.newPassword, 'new-password')}
        <button class="button auth-submit" type="submit" ${state.busy ? 'disabled' : ''}>${esc(state.busy ? copy.loading : copy.auth.confirm)}</button>
        ${back}
      </form>
    </section>`
  }
  if (state.authStep === 'code') {
    return `<section class="panel auth-panel">
      <form id="auth-code" class="auth-card">
        <img class="auth-mark" src="/favicon.svg" alt="">
        <h1>${esc(copy.auth.code)}</h1>
        <p class="lede">${esc(copy.auth.codeLede)}</p>
        ${banner()}
        <label class="field"><span>${esc(copy.auth.code)}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
        <button class="button auth-submit" type="submit" ${state.busy ? 'disabled' : ''}>${esc(copy.auth.confirm)}</button>
      </form>
    </section>`
  }
  return `<section class="panel auth-panel">
    <form id="auth-form" class="auth-card">
      <img class="auth-mark" src="/favicon.svg" alt="">
      <h1>${esc(title)}</h1>
      <p class="lede">${esc(lede)}</p>
      ${banner()}
      <label class="field"><span>${esc(copy.auth.email)}</span><input name="email" type="email" autocomplete="email" required></label>
      ${passwordField(copy.auth.password, join ? 'new-password' : 'current-password')}
      ${join ? '' : `<p class="auth-forgot"><button type="button" class="text-button" data-action="forgot-password">${esc(copy.auth.forgot)}</button></p>`}
      <button class="button auth-submit" type="submit" ${state.busy ? 'disabled' : ''}>${esc(state.busy ? copy.loading : copy.auth.confirm)}</button>
      ${guestButton() ? `<p class="auth-guest">${guestButton()}</p>` : ''}
      <p class="auth-switch">${switchLine}</p>
    </form>
  </section>`
}

function fields(values) {
  return `
    <h2 class="section-label">${esc(copy.studio.about)}</h2>
    <label class="field"><span>${esc(copy.studio.name)}</span><input name="displayName" value="${esc(values.displayName || '')}"></label>
    <label class="field"><span>${esc(copy.studio.line)}</span><input name="headline" value="${esc(values.headline || '')}"></label>
    <label class="field"><span>${esc(copy.studio.email)}</span><input name="email" type="email" value="${esc(values.email || '')}"></label>
    <label class="field"><span>${esc(copy.studio.place)}</span><input name="location" value="${esc(values.location || '')}"></label>
    <label class="field"><span>${esc(copy.studio.experience)}</span><textarea name="experience" placeholder="${esc(copy.studio.experiencePlaceholder)}">${esc(values.experience || '')}</textarea></label>
    <p class="help">${esc(copy.studio.experienceHelp)}</p>
    <label class="field"><span>${esc(copy.studio.education)}</span><textarea name="education" placeholder="${esc(copy.studio.educationPlaceholder)}">${esc(values.education || '')}</textarea></label>
    <p class="help">${esc(copy.studio.educationHelp)}</p>`
}

function isProfileRepo(project) {
  const [owner, repo] = String(project.fullName || '').split('/')
  return Boolean(owner && repo && owner.toLowerCase() === repo.toLowerCase())
}

function projectsInScope(visibility) {
  return state.projects.filter((project) => {
    if (isProfileRepo(project)) return false
    return visibility === 'all' || !project.private
  })
}

function mergeRoleRepos(scope, role, selected, { fillEmpty = false } = {}) {
  const pool = projectsInScope(scope)
  const allowed = new Set(pool.map((project) => project.fullName))
  let repos = [...new Set((selected || []).filter((name) => allowed.has(name)))]
  const roleText = String(role || '').trim()
  if (!roleText) {
    return fillEmpty && !repos.length ? pool.filter((project) => !project.fork).map((project) => project.fullName) : repos
  }
  const matched = fullNamesForRole(pool, roleText)
  if (fillEmpty && !repos.length) {
    repos = matched.length ? matched : pool.filter((project) => !project.fork).map((project) => project.fullName)
    return repos.filter((name) => !state.deselectedRepos.has(name))
  }
  for (const fullName of matched) {
    if (state.deselectedRepos.has(fullName) || repos.includes(fullName)) continue
    repos.push(fullName)
  }
  return repos
}

function absorbNewRoleRepos(scope, role, selected, previousNames) {
  const roleText = String(role || '').trim()
  const prev = previousNames || new Set()
  if (!roleText || !prev.size) return selected
  const pool = projectsInScope(scope)
  const newcomers = pool.filter((project) => !prev.has(project.fullName))
  if (!newcomers.length) return selected
  const matched = new Set(fullNamesForRole(newcomers, roleText))
  const repos = [...(selected || [])]
  for (const project of newcomers) {
    if (!matched.has(project.fullName) || state.deselectedRepos.has(project.fullName)) continue
    if (!repos.includes(project.fullName)) repos.push(project.fullName)
  }
  return repos
}

function projectList(selected, visibility) {
  const chosen = new Set(selected || [])
  if (state.projectsLoading || state.projectsRetrying || needsProjectsLoad(visibility)) {
    return `<p class="quiet">${esc(state.projectsRetrying ? copy.errors.stillWorking : copy.errors.loadingProjects)}</p>`
  }
  if (state.needGithub) return `<p class="quiet">${esc(copy.errors.connectWork)}</p>`
  if (state.needPrivate) {
    return `<p class="quiet">${esc(copy.errors.needPrivate)}</p><p><a class="button" href="/api/auth/github?visibility=all">${esc(copy.studio.allow)}</a></p>`
  }
  if (state.projectsError) return `<p class="banner">${esc(state.projectsError)}</p>`
  const projects = projectsInScope(visibility)
  if (!projects.length) return `<p class="quiet">${esc(copy.studio.empty)}</p>`
  return `<div class="projects">
    ${projects.map((project) => `<label class="project ${chosen.has(project.fullName) ? 'is-on' : ''}">
      <input type="checkbox" name="repo" value="${esc(project.fullName)}" data-private="${project.private ? '1' : '0'}" data-fork="${project.fork ? '1' : '0'}" ${chosen.has(project.fullName) ? 'checked' : ''}>
      <span>
        <strong>${esc(project.name)}</strong>
        ${project.stars > 0 ? `<span class="star-count">${esc(starCount(project.stars))}</span>` : ''}
        ${project.private ? `<em>${esc(copy.studio.private)}</em>` : ''}
        ${project.fork ? `<em>${esc(copy.studio.copied)}</em>` : ''}
        ${project.description ? `<small>${esc(project.description)}</small>` : ''}
        <small>${esc(project.updatedLabel || '')}</small>
      </span>
    </label>`).join('')}
  </div>`
}

function projectChoices(values) {
  const current = values.visibility === 'all' ? 'all' : 'public'
  const options = [
    ['public', copy.start.publicTitle, copy.start.publicBody],
    ['all', copy.start.allTitle, copy.start.allBody],
  ]
  return `<div class="choice-row">
    ${options.map(([value, title, body]) => {
      const on = current === value
      return `<div class="choice-block ${on ? 'is-on' : ''}" data-scope="${value}">
        <label class="choice ${on ? 'is-on' : ''}">
          <input type="radio" name="visibility" value="${value}" ${on ? 'checked' : ''}>
          <span><strong>${esc(title)}</strong>${esc(body)}</span>
        </label>
        ${on && (state.projectsLoading || state.projectsRetrying || needsProjectsLoad(value)) ? `<p class="quiet">${esc(state.projectsRetrying ? copy.errors.stillWorking : copy.errors.loadingProjects)}</p><div class="wait-bar" role="progressbar" aria-busy="true"><span></span></div>` : ''}
        ${on && state.projectsError && !state.projectsRetrying ? `<p class="banner">${esc(state.projectsError)}</p><div class="actions"><button class="button secondary" type="button" data-action="retry-projects">${esc(copy.detail.check)}</button>${state.projectsError === copy.errors.sessionLost ? `<a class="button" href="${signInAgainPath()}" data-go="${signInAgainPath()}">${esc(copy.nav.login)}</a>` : ''}</div>` : ''}
        ${on && state.needGithub ? `<p class="quiet">${esc(copy.errors.connectWork)}</p>` : ''}
        ${on && state.needPrivate ? `<p class="quiet">${esc(copy.errors.needPrivate)}</p><p><a class="button" href="/api/auth/github?visibility=all">${esc(copy.studio.allow)}</a></p>` : ''}
        ${on && !state.needPrivate && !state.needGithub && !state.projectsLoading && !state.projectsRetrying && !needsProjectsLoad(value) && !state.projectsError ? `<div class="choice-tools">
          <button class="text-button" type="button" data-action="toggle-projects">${esc(state.projectsOpen ? copy.studio.hideProjects : copy.studio.leaveSome)}</button>
          ${projectsInScope(value).some((project) => project.fork) ? `<button class="text-button" type="button" data-action="leave-forks">${esc(copy.studio.leaveForks)}</button>` : ''}
          <span class="help" data-total></span>
          <span class="help" data-count></span>
        </div>
        ${state.projectsOpen ? projectList(values.repos, value) : ''}` : ''}
      </div>`
    }).join('')}
  </div>`
}

function briefFields(values) {
  return `
    <label class="field"><span>${esc(copy.studio.role)}</span><input name="roleTarget" value="${esc(values.roleTarget || '')}" placeholder="${esc(copy.studio.rolePlaceholder)}"></label>
    <label class="field"><span>${esc(copy.studio.brief)}</span><textarea name="instructions" placeholder="${esc(copy.studio.briefPlaceholder)}">${esc(values.instructions || '')}</textarea></label>
    <p class="help">${esc(copy.studio.briefHelp)}</p>`
}

function viewStudio() {
  const account = state.me?.account
  if (!account) return `<section class="panel"><p>${esc(copy.errors.signedOut)}</p></section>`
  const values = state.form || blankForm(account)
  return `<section class="panel">
    <h1>${esc(copy.studio.title)}</h1>
    <p class="lede">${esc(copy.studio.lede)}</p>
    ${guestBanner()}
    ${banner()}
    <form id="editor">
      ${fields(values)}
      <h2 class="section-label">${esc(copy.studio.projects)}</h2>
      <p class="help">${esc(copy.studio.projectsHelp)}</p>
      ${projectChoices(values)}
      ${briefFields(values)}
      <button class="button" type="submit" ${state.busy || state.projectsLoading || needsProjectsLoad(values.visibility === 'all' ? 'all' : 'public') ? 'disabled' : ''}>${esc(state.busy || state.projectsLoading || needsProjectsLoad(values.visibility === 'all' ? 'all' : 'public') ? copy.studio.creating : copy.studio.create)}</button>
    </form>
  </section>`
}

function removeControls(id, label = copy.detail.remove) {
  if (state.confirmRemove === id) {
    return `<div class="link-remove">
      <p class="help">${esc(copy.detail.confirm)}</p>
      <div class="actions">
        <button class="button danger" type="button" data-action="remove" data-id="${esc(id)}">${esc(copy.detail.yesRemove)}</button>
        <button class="button secondary" type="button" data-action="keep-link">${esc(copy.detail.keep)}</button>
      </div>
    </div>`
  }
  return `<button class="button danger" type="button" data-action="ask-remove" data-id="${esc(id)}">${esc(label)}</button>`
}

function viewLinks() {
  if (!state.links.length) {
    return `<section class="list-page"><h1>${esc(copy.links.title)}</h1>${guestBanner()}${banner()}<p class="lede">${esc(copy.links.empty)}</p><a class="button" href="/studio" data-go="/studio">${esc(copy.nav.newLink)}</a></section>`
  }
  return `<section class="list-page">
    <h1>${esc(copy.links.title)}</h1>
    ${guestBanner()}
    ${banner()}
    <div class="cards">
      ${state.links.map((link) => `<div class="card">
        <a class="card-main" href="/links/${esc(link.id)}" data-go="/links/${esc(link.id)}">
          <span><strong>${esc(link.roleTarget)}</strong><small class="quiet">${esc(link.refreshedLabel || link.lastError || '')}</small></span>
        </a>
        <span class="card-side">
          <a href="/links/${esc(link.id)}" data-go="/links/${esc(link.id)}">${esc(copy.links.open)}</a>
          ${state.confirmRemove === link.id
            ? `<button class="text-button danger" type="button" data-action="remove" data-id="${esc(link.id)}">${esc(copy.links.yesRemove)}</button><button class="text-button" type="button" data-action="keep-link">${esc(copy.detail.keep)}</button>`
            : `<button class="text-button danger" type="button" data-action="ask-remove" data-id="${esc(link.id)}">${esc(copy.links.remove)}</button>`}
        </span>
      </div>`).join('')}
    </div>
  </section>`
}

function formFromLink(link) {
  return {
    displayName: link.displayName || '',
    headline: link.headline || '',
    email: link.email || '',
    location: link.location || '',
    education: link.education || '',
    experience: link.experience || '',
    roleTarget: link.roleTarget || '',
    instructions: link.instructions || '',
    visibility: link.visibility || 'public',
    repos: link.selectedRepos || [],
  }
}

function viewDetail() {
  const link = state.current
  if (!link) return `<section class="panel"><p class="quiet">${esc(copy.loading)}</p></section>`
  if (!link.resume && link.status !== 'error') {
    if (state.stalled) {
      return `<section class="panel wait">
        <h1>${esc(copy.detail.slow)}</h1>
        <div class="actions">
          <button class="button" type="button" data-action="refresh" ${state.busy ? 'disabled' : ''}>${esc(copy.detail.check)}</button>
          ${removeControls(link.id)}
        </div>
      </section>`
    }
    return `<section class="panel wait">
      <h1>${esc(copy.detail.waiting)}</h1>
      <div class="wait-bar" role="progressbar" aria-busy="true" aria-label="${esc(copy.detail.waiting)}"><span></span></div>
      <p class="quiet">${esc(copy.detail.same)}</p>
      <div class="actions">
        <button class="button secondary" type="button" data-action="refresh" ${state.busy ? 'disabled' : ''}>${esc(copy.detail.check)}</button>
        ${removeControls(link.id)}
      </div>
    </section>`
  }
  if (!link.resume) {
    return `<section class="panel">${banner()}<p class="banner">${esc(link.lastError || copy.errors.readFailed)}</p>
      <div class="actions">
        <button class="button" type="button" data-action="refresh">${esc(copy.detail.check)}</button>
        ${removeControls(link.id)}
      </div></section>`
  }
  const values = state.form || formFromLink(link)
  return `<section class="panel split">
    <div>
      <h1>${esc(values.displayName || copy.name)}</h1>
      ${state.privateNote ? `<p class="quiet">${esc(state.privateNote)}</p>` : ''}
      <p class="meta"><span class="quiet">${esc(link.refreshedLabel)}</span>${link.reason ? `<span>${esc(link.reason)}</span>` : ''}</p>
      ${(link.trendNotes || []).map((note) => `<p>${esc(note)}</p>`).join('')}
      ${link.lastError ? `<p class="banner">${esc(link.lastError)}</p>` : ''}
      ${banner()}
      <p class="section-label">${esc(copy.detail.pdf)}</p>
      <div class="link-box">
        <input readonly value="${esc(link.pdfUrl)}" id="pdf-url">
        <button class="button" type="button" data-action="copy">${esc(copy.detail.copy)}</button>
      </div>
      <p class="help">${esc(copy.detail.same)}</p>
      <p><a href="${esc(link.pageUrl)}">${esc(copy.detail.page)}</a></p>
      <form id="editor">
        ${fields(values)}
        <h2 class="section-label">${esc(copy.studio.projects)}</h2>
        ${projectChoices(values)}
        ${briefFields(values)}
        <div class="actions">
          <button class="button" type="submit" ${state.busy ? 'disabled' : ''}>${esc(state.busy ? copy.detail.saving : copy.detail.save)}</button>
          <button class="button secondary" type="button" data-action="refresh" ${state.busy ? 'disabled' : ''}>${esc(state.busy ? copy.detail.checking : copy.detail.check)}</button>
        </div>
      </form>
      ${removeControls(link.id)}
      ${state.confirmRemove === link.id ? '' : `<p class="help">${esc(copy.detail.removeHelp)}</p>`}
    </div>
    <div class="paper-column">
      <div class="paper-tools">
        ${paperDownload(link.pdfUrl)}
        <button class="text-button" type="button" data-action="edit-paper">${esc(state.editing ? copy.studio.done : copy.studio.edit)}</button>
      </div>
      <div class="paper-frame">${state.editing
        ? `<div id="paper-slot" data-paper-root>${paper(link.resume)}</div>`
        : `<iframe class="pdf-view" src="${esc(link.pdfUrl)}" title="${esc(copy.detail.pdf)}"></iframe>`}</div>
    </div>
  </section>`
}

function viewMissing() {
  return `<section class="panel"><h1>${esc(copy.missing.title)}</h1><a href="/" data-go="/">${esc(copy.missing.home)}</a></section>`
}

function blankForm(account) {
  const params = new URLSearchParams(location.search)
  const visibility = (params.get('visibility') === 'all' || account?.preview) ? 'all' : 'public'
  return {
    displayName: account?.name || '',
    headline: account?.headline != null ? account.headline : (account?.bio || ''),
    email: account?.email || '',
    location: account?.location || '',
    education: '',
    experience: '',
    roleTarget: '',
    instructions: '',
    visibility,
    repos: [],
  }
}

function readEditor(form) {
  const data = new FormData(form)
  return {
    displayName: String(data.get('displayName') || ''),
    headline: String(data.get('headline') || ''),
    email: String(data.get('email') || ''),
    location: String(data.get('location') || ''),
    education: String(data.get('education') || ''),
    experience: String(data.get('experience') || ''),
    roleTarget: String(data.get('roleTarget') || ''),
    instructions: String(data.get('instructions') || ''),
    visibility: data.get('visibility') === 'all' ? 'all' : 'public',
    repos: form.querySelector('input[name="repo"]') ? data.getAll('repo').map(String) : (state.form?.repos || []),
  }
}

function updateCount() {
  const boxes = document.querySelectorAll('#editor input[name="repo"]')
  const count = boxes.length
    ? document.querySelectorAll('#editor input[name="repo"]:checked').length
    : (state.form?.repos || []).length
  const node = document.querySelector('[data-count]')
  if (node) node.textContent = `${count} ${copy.studio.count}`
  const totalNode = document.querySelector('[data-total]')
  const total = state.counts?.all
  if (totalNode) totalNode.textContent = total == null ? '' : `${total} ${copy.studio.found}`
  const publicBoxes = [...document.querySelectorAll('#editor input[name="repo"]')].filter((box) => box.dataset.private !== '1')
  const selectAll = document.querySelector('#editor [data-select-public]')
  if (selectAll) selectAll.checked = publicBoxes.length > 0 && publicBoxes.every((box) => box.checked)
  document.querySelectorAll('#editor .project').forEach((card) => {
    const box = card.querySelector('input')
    card.classList.toggle('is-on', Boolean(box?.checked))
  })
  document.querySelectorAll('#editor .choice').forEach((card) => {
    const box = card.querySelector('input')
    card.classList.toggle('is-on', Boolean(box?.checked))
  })
}

function syncGuestProjects() {
  if (!guestSampleMode()) return
  rememberPreviewProjects(state.me)
  const scope = currentProjectScope()
  if (state.previewProjectPool?.length && state.projectsLoadedFor !== scope) {
    applyPreviewProjects(scope)
    state.projectsLoading = false
    state.projectsRetrying = false
  }
}

function render() {
  const route = parse(location.pathname)
  if (route.name === 'studio' || route.name === 'detail') syncGuestProjects()
  document.querySelector('#top').innerHTML = header()
  const main = document.querySelector('#main')
  if (route.name === 'sign-in' && state.me?.account && (state.me.guest || state.me.account.preview)) {
    go('/studio')
    return
  }
  if ((route.name === 'sign-in' || route.name === 'join') && state.me?.account && !state.me.account.preview) {
    go(safeNext() || (state.me.account.githubConnected ? '/links' : '/start'))
    return
  }
  if ((route.name === 'studio' || route.name === 'links' || route.name === 'detail') && state.me && !state.me.account) {
    const next = route.name === 'detail' ? `/links/${route.id}` : `/${route.name}`
    go(state.me.signInReady ? `/sign-in?next=${encodeURIComponent(next)}` : '/start')
    return
  }
  if (route.name === 'studio' && state.me?.account && !state.me.account.preview && !state.me.account.githubConnected) {
    go('/start')
    return
  }
  if (route.name === 'callback') {
    main.innerHTML = `<section class="panel"><p class="quiet">${esc(copy.loading)}</p></section>`
    if (!state.callbackStarted && state.me?.publishableKey) {
      state.callbackStarted = true
      authModule().then(({ finishGoogleRedirect, clerkMessage }) =>
        finishGoogleRedirect(state.me.publishableKey).catch((error) => {
          state.callbackStarted = false
          state.error = clerkMessage(error)
          go('/sign-in')
        }),
      )
    }
    return
  }
  if (route.name === 'detail') {
    if (state.current?.id !== route.id) {
      main.innerHTML = `<section class="panel"><p class="quiet">${esc(copy.loading)}</p></section>`
      openDetail(route.id)
      return
    }
  }
  if (route.name === 'links' && state.linksStamp !== state.me?.account?.login) {
    main.innerHTML = `<section class="panel"><p class="quiet">${esc(copy.loading)}</p></section>`
    openLinks()
    return
  }
  if (route.name === 'studio' && state.form && !state.reposTouched && !state.projectsLoading) {
    const scope = state.form.visibility === 'all' ? 'all' : 'public'
    if (!state.form.repos.length && !state.needGithub && !state.needPrivate && !state.projectsError && state.projects.length) {
      state.form.repos = mergeRoleRepos(scope, state.form.roleTarget, [], { fillEmpty: true })
    }
  }
  const views = {
    home: viewHome,
    start: viewStart,
    'sign-in': viewAuth,
    join: viewAuth,
    studio: viewStudio,
    links: viewLinks,
    detail: viewDetail,
    missing: viewMissing,
  }
  main.innerHTML = (views[route.name] || viewMissing)()
  main.removeAttribute('aria-busy')
  if ((route.name === 'sign-in' || route.name === 'join') && state.me?.publishableKey) {
    const node = document.getElementById('clerk-auth')
    if (node) {
      authModule().then(({ showClerkAuth, clerkMessage }) =>
        showClerkAuth(node, state.me.publishableKey, {
          mode: route.name === 'join' ? 'join' : 'login',
          next: safeNext(),
        }).catch((error) => {
          state.error = clerkMessage(error)
          render()
        }),
      )
    }
  }
  document.title = copy.name
  maybeLoadProjects()
  updateCount()
  if (!state.editing) schedulePaperLayout()
}

async function ensureProjects(visibility) {
  const seq = ++projectsLoadSeq
  state.projectsFor = visibility
  if (guestSampleMode()) rememberPreviewProjects(state.me)
  if (applyPreviewProjects(visibility)) {
    state.projectsLoading = false
    state.projectsRetrying = false
    state.projectsError = ''
    const editor = document.querySelector('#editor')
    if (editor) {
      const next = readEditor(editor)
      const scope = next.visibility || visibility
      const role = next.roleTarget || ''
      if (!state.reposTouched && (state.fillRepos || !next.repos.length)) {
        next.repos = mergeRoleRepos(scope, role, [], { fillEmpty: true })
        state.filledFor = scope
      }
      state.form = next
    }
    render()
    return
  }
  state.projectsLoading = true
  state.projectsLoadingSince = Date.now()
  state.projectsRetrying = false
  state.projectsError = ''
  render()
  const maxAttempts = 3
  let data = null
  let lastError = null
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (seq !== projectsLoadSeq) return
      if (attempt > 0) {
        state.projectsRetrying = true
        state.projectsError = ''
        render()
        await apiDelay(Math.min(4500, 450 * attempt))
        await refreshMe()
      }
      try {
        data = await apiOnce(`/api/projects?visibility=${encodeURIComponent(visibility)}`, { timeoutMs: 15000 })
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          lastError = new Error(copy.errors.gaveUp)
          lastError.status = 408
        }
        const canRetry = attempt < maxAttempts - 1
        const authMiss = error.status === 401 || error.message === copy.errors.signedOut
        const transient = error.status >= 500 || error.status === 429 || error.status === 408
          || error.message === copy.errors.generic
        if (canRetry && (authMiss || transient)) continue
        break
      }
    }
    if (seq !== projectsLoadSeq) return
    state.projectsRetrying = false
    if (data) {
      state.projects = data.projects || []
      state.counts = data.counts || { all: state.projects.length }
      state.needPrivate = Boolean(data.needPrivate)
      state.needGithub = Boolean(data.needGithub)
      state.projectsError = ''
      state.projectsLoadedFor = visibility
    } else if (lastError) {
      state.projectsLoadedFor = ''
      state.projectsError = lastError.status === 401 ? copy.errors.sessionLost : lastError.message
      state.projects = []
      state.counts = null
      state.needGithub = false
    }
    const editor = document.querySelector('#editor')
    if (editor) {
      const next = readEditor(editor)
      if (!editor.querySelector('input[name="repo"]')) next.repos = state.form?.repos || []
      const scope = next.visibility || visibility
      const ready = !state.projectsError && !state.needPrivate && !state.needGithub
      const prevNames = state.projectNamesSeen || new Set()
      const role = next.roleTarget || ''
      if (state.needPrivate) {
        next.repos = []
      } else if (ready) {
        if (!state.reposTouched && (state.fillRepos || !next.repos.length)) {
          next.repos = mergeRoleRepos(scope, role, [], { fillEmpty: true })
          state.filledFor = scope
        } else if (role) {
          next.repos = absorbNewRoleRepos(scope, role, next.repos, prevNames)
        }
      }
      state.projectNamesSeen = new Set(state.projects.map((project) => project.fullName))
      state.fillRepos = false
      state.form = next
    }
    state.projectsLoading = false
    state.projectsRetrying = false
    render()
  } catch (error) {
    console.error('projects load failed', error)
  } finally {
    if (seq === projectsLoadSeq && (state.projectsLoading || state.projectsRetrying)) {
      state.projectsLoading = false
      state.projectsRetrying = false
      render()
    }
  }
}

async function openDetail(id) {
  const token = ++state.watchToken
  try {
    state.current = await api(`/api/links/${id}`)
    state.form = formFromLink(state.current)
    state.filledFor = state.current.visibility || 'public'
    state.fillRepos = false
    state.projectsOpen = false
    const scope = state.current.visibility === 'all' ? 'all' : 'public'
    if (state.projectsLoadedFor !== scope) {
      state.projectsFor = ''
      state.projectsLoadedFor = ''
    }
    state.error = ''
    state.stalled = false
  } catch (error) {
    state.current = null
    state.error = error.message
    document.querySelector('#main').innerHTML = `<section class="panel">${banner()}</section>`
    return
  }
  if (state.watchToken !== token) return
  render()
  if (state.current?.status === 'preparing') {
    kickRefresh(id)
    watch(id, token)
  } else settlePrivate(state.current)
}

function kickRefresh(id) {
  api(`/api/links/${id}/refresh`, { method: 'POST', body: { full: true } }).catch(() => {})
}

async function watch(id, token) {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    if (state.watchToken !== token) return
    try {
      const link = await api(`/api/links/${id}`)
      if (link.status === 'preparing') continue
      state.current = link
      state.form = formFromLink(link)
      render()
      settlePrivate(link)
      return
    } catch (error) {
      state.error = error.message
      render()
      return
    }
  }
  if (state.watchToken !== token) return
  kickRefresh(id)
  state.stalled = true
  render()
}

function localKey(link) {
  return `${link.id}:${(link.localReads || []).map((item) => item.fullName).join('|')}`
}

async function settlePrivate(link) {
  if (!link?.localReads?.length) return
  const key = localKey(link)
  if (state.privateBusy || state.localTried.has(key)) return
  state.localTried.add(key)
  state.privateBusy = true
  state.privateNote = copy.detail.readingPrivate
  render()
  try {
    let tokens = {}
    if (!state.me?.account?.preview) {
      const reader = await api(`/api/github/reader?link=${encodeURIComponent(link.id)}`)
      tokens = reader.tokens || {}
    }
    const { readPrivateLocally } = await import('./privateRead.js')
    const readings = await readPrivateLocally(link.localReads, {
      preview: Boolean(state.me?.account?.preview),
      tokens,
    })
    if (!readings.length) throw new Error('empty')
    const updated = await api(`/api/links/${link.id}/local`, { method: 'POST', body: { readings } })
    if (state.current?.id === link.id) {
      state.current = updated
      state.form = formFromLink(updated)
    }
    state.privateNote = ''
  } catch (error) {
    state.privateNote = ''
    if (state.current?.id === link.id) {
      state.error = error?.status === 409 ? copy.errors.needAppInstall : copy.detail.privateMissed
    }
  } finally {
    state.privateBusy = false
    render()
  }
}

async function openLinks() {
  if (!state.me?.account) {
    go('/start')
    return
  }
  try {
    const data = await api('/api/links')
    state.links = data.links || []
    state.linksStamp = state.me.account.login
  } catch (error) {
    state.error = error.message
  }
  render()
}

async function loadBootMe() {
  let lastError
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await apiOnce('/api/me', { timeoutMs: 15000 })
    } catch (error) {
      lastError = error
      const retry = attempt < 5 && (error.status === 401 || error.status >= 500 || error.status === 429)
      if (!retry) throw error
      await apiDelay(400 * (attempt + 1))
    }
  }
  throw lastError
}

function fallbackMe() {
  return {
    account: null,
    guest: true,
    githubReady: false,
    signInReady: false,
    publishableKey: '',
  }
}

async function hydrateExampleResume() {
  try {
    const example = await api('/api/example', { timeoutMs: 12000, noRetry: true }).catch(() => ({ resume: null }))
    state.example = example.resume
    if (state.me?.account) {
      state.form = blankForm(state.me.account)
      state.filledFor = ''
      state.reposTouched = false
      state.fillRepos = true
      state.projectsLoadedFor = ''
    }
  } catch (error) {
    if (!state.error) state.error = error.message
  } finally {
    stripClerkNoiseFromUrl()
    render()
    maybeLoadProjects()
  }
}

function deferExampleResume() {
  const run = () => { void hydrateExampleResume() }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2200 })
  else setTimeout(run, 0)
}

function readStoredBinding() {
  try {
    const raw = localStorage.getItem(BINDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.login !== 'string') return null
    return {
      login: parsed.login,
      preview: Boolean(parsed.preview),
      githubConnected: Boolean(parsed.githubConnected),
    }
  } catch {
    return null
  }
}

function rememberBinding(account) {
  const next = bindingFromAccount(account)
  const prev = readStoredBinding()
  try {
    if (next) localStorage.setItem(BINDING_KEY, JSON.stringify(next))
    else localStorage.removeItem(BINDING_KEY)
  } catch {
    // A private window can refuse storage. The session cookie still decides the account.
  }
  return { prev, next, changed: Boolean(prev && next && !sameBinding(prev, next)) }
}

function forgetBinding() {
  try {
    localStorage.removeItem(BINDING_KEY)
  } catch {
    // Storage can be unavailable. Leaving guest mode still clears the cookie.
  }
}

function releaseSampleProjects() {
  state.previewProjectPool = null
  state.projects = []
  state.projectsFor = ''
  state.projectsLoadedFor = ''
  state.counts = null
  state.links = []
  state.linksStamp = ''
  state.needGithub = false
  state.form = null
  state.filledFor = ''
  state.reposTouched = false
  state.fillRepos = true
}

function accountFromBinding(binding) {
  if (!binding?.githubConnected) return null
  return {
    account: {
      login: binding.login,
      name: binding.login,
      preview: false,
      githubConnected: true,
    },
    guest: false,
  }
}

async function boot() {
  const known = accountFromBinding(readStoredBinding())
  if (known) state.me = known
  try {
    state.me = await loadBootMe()
    const shift = rememberBinding(state.me?.account)
    if (!state.me?.account) forgetBinding()
    if (shift.changed) releaseSampleProjects()
    rememberPreviewProjects(state.me)
    const bootRoute = parse(location.pathname)
    if (bootRoute.name === 'studio' && guestSampleMode()) {
      const vis = new URLSearchParams(location.search).get('visibility') === 'all' ? 'all' : 'public'
      applyPreviewProjects(vis)
      state.projectsLoading = false
      state.projectsRetrying = false
    }
  } catch (error) {
    state.error = error.message
    state.me = state.me || fallbackMe()
  }
  stripClerkNoiseFromUrl()
  render()
  deferExampleResume()
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.getAttribute('data-action')
  if (action) event.preventDefault()
  const goLink = action ? null : event.target.closest('[data-go]')
  if (goLink) {
    event.preventDefault()
    const path = goLink.getAttribute('data-go')
    const name = parse(String(path || '').split('?')[0]).name
    if (name === 'sign-in' || name === 'join') {
      window.location.assign(path)
      return
    }
    go(path)
    return
  }
  if (!action) return
  if (action === 'forgot-password') {
    const email = document.querySelector('#auth-form input[name="email"]')?.value || ''
    state.resetEmail = email.trim()
    state.authStep = 'forgot'
    state.error = ''
    render()
    return
  }
  if (action === 'show-login') {
    state.authStep = 'details'
    state.error = ''
    render()
    return
  }
  if (action === 'toggle-password') {
    const wrap = event.target.closest('.password-wrap')
    const input = wrap?.querySelector('input')
    const btn = wrap?.querySelector('.password-toggle')
    if (!input || !btn) return
    const show = input.type === 'password'
    input.type = show ? 'text' : 'password'
    btn.setAttribute('aria-pressed', show ? 'true' : 'false')
    btn.setAttribute('aria-label', show ? copy.auth.hidePassword : copy.auth.showPassword)
    btn.classList.toggle('is-revealed', show)
    return
  }
  if (action === 'toggle-projects') {
    event.preventDefault()
    const form = event.target.closest('form')
    const scope = event.target.closest('[data-scope]')?.getAttribute('data-scope') === 'all' ? 'all' : 'public'
    const radio = form?.querySelector(`input[name="visibility"][value="${scope}"]`)
    if (radio && !radio.checked) {
      radio.checked = true
      state.projectsOpen = false
      state.fillRepos = true
      state.form = readEditor(form)
      state.projectsFor = ''
      state.projectsLoadedFor = ''
      ensureProjects(scope)
      return
    }
    if (form) state.form = readEditor(form)
    state.projectsOpen = !state.projectsOpen
    render()
    return
  }
  if (action === 'leave-forks') {
    event.preventDefault()
    state.reposTouched = true
    const form = event.target.closest('form')
    const scope = form?.querySelector('input[name="visibility"]:checked')?.value === 'all' ? 'all' : 'public'
    const forks = new Set(projectsInScope(scope).filter((project) => project.fork).map((project) => project.fullName))
    form?.querySelectorAll('input[name="repo"]').forEach((box) => {
      if (box.dataset.fork === '1') box.checked = false
    })
    if (form) state.form = readEditor(form)
    if (state.form) state.form.repos = (state.form.repos || []).filter((name) => !forks.has(name))
    render()
    return
  }
  if (action === 'logout') {
    const key = state.me?.publishableKey
    state.busy = true
    render()
    try {
      await api('/api/guest?action=leave', { method: 'POST', body: {} })
    } catch {
      /* clear local session even if the server call failed */
    }
    forgetBinding()
    state.me = { ...(state.me || {}), account: null, guest: false }
    state.previewProjectPool = null
    state.projects = []
    state.projectsLoadedFor = ''
    state.projectsLoading = false
    state.current = null
    state.linksStamp = ''
    state.form = null
    state.busy = false
    go('/')
    if (key) authModule().then(({ loadClerk }) => loadClerk(key).then((clerk) => clerk.signOut())).catch(() => {})
    return
  }
  if (action === 'guest' || action === 'practice') {
    state.busy = true
    render()
    try {
      const data = await api('/api/guest', { method: 'POST', body: {} })
      state.me = { ...(state.me || {}), account: data.account, guest: true }
      const shift = rememberBinding(data.account)
      if (shift.changed) releaseSampleProjects()
      rememberPreviewProjects(data)
      applyPreviewProjects('public')
      state.form = blankForm(data.account)
      state.projectsFor = 'public'
      state.filledFor = ''
      state.reposTouched = false
      state.fillRepos = true
      state.busy = false
      go('/studio')
    } catch (error) {
      state.busy = false
      state.error = error.message
      render()
    }
  }
  if (action === 'copy') {
    const input = document.querySelector('#pdf-url')
    try {
      await navigator.clipboard.writeText(input.value)
    } catch {
      input.select()
      document.execCommand('copy')
    }
    event.target.textContent = copy.detail.copied
  }
  if (action === 'ask-remove') {
    event.preventDefault()
    state.confirmRemove = event.target.closest('[data-id]')?.getAttribute('data-id') || state.current?.id || ''
    render()
  }
  if (action === 'retry-projects') {
    event.preventDefault()
    state.projectsError = ''
    state.projectsFor = ''
    state.projectsLoadedFor = ''
    const form = document.querySelector('#editor')
    const scope = form?.querySelector('input[name="visibility"]:checked')?.value === 'all' ? 'all' : 'public'
    ensureProjects(scope)
    return
  }
  if (action === 'edit-paper') {
    event.preventDefault()
    state.editing = !state.editing
    render()
    return
  }
  if (action === 'keep-link') {
    event.preventDefault()
    state.confirmRemove = false
    render()
  }
  if (action === 'remove') {
    event.preventDefault()
    const id = event.target.closest('[data-id]')?.getAttribute('data-id') || state.current?.id
    if (!id) return
    try {
      await api(`/api/links/${id}`, { method: 'DELETE' })
      state.links = state.links.filter((link) => link.id !== id)
      if (state.current?.id === id) state.current = null
      state.linksStamp = ''
      state.confirmRemove = false
      state.notice = copy.notice.removed
      if (parse(location.pathname).name === 'links') render()
      else go('/links')
    } catch (error) {
      state.error = error.message
      render()
    }
  }
  if (action === 'refresh') {
    const id = state.current?.id
    if (!id) return
    state.busy = true
    state.error = ''
    for (const key of state.localTried) {
      if (key.startsWith(`${id}:`)) state.localTried.delete(key)
    }
    render()
    try {
      const link = await api(`/api/links/${id}/refresh`, { method: 'POST', body: {} })
      state.current = link
      state.notice = link.message || ''
      state.busy = false
      state.stalled = false
      render()
      if (link.status === 'preparing') watch(link.id, ++state.watchToken)
      else await settlePrivate(link)
      if (state.current?.visibility) {
        state.projectsFor = ''
        ensureProjects(state.current.visibility === 'all' ? 'all' : 'public')
      }
      return
    } catch (error) {
      state.error = error.message
    } finally {
      state.busy = false
      render()
    }
  }
})

document.addEventListener('change', (event) => {
  const form = event.target.closest('form')
  form?.querySelectorAll('.choice, .project').forEach((card) => {
    const box = card.querySelector('input')
    card.classList.toggle('is-on', Boolean(box?.checked))
  })
  if (event.target.name === 'visibility' && form?.id === 'editor') {
    state.form = readEditor(form)
    state.fillRepos = true
    state.projectsOpen = false
    state.projectsFor = ''
    state.projectsLoadedFor = ''
    state.projectNamesSeen = null
    ensureProjects(state.form.visibility)
  }
  if (event.target.name === 'repo') {
    state.reposTouched = true
    if (!event.target.checked) state.deselectedRepos.add(event.target.value)
    else state.deselectedRepos.delete(event.target.value)
    if (form) state.form = readEditor(form)
    updateCount()
  }
})

async function submitAuth(form) {
  const key = state.me?.publishableKey
  if (!key) {
    state.error = copy.auth.notReady
    render()
    return
  }
  const data = new FormData(form)
  const email = String(data.get('email') || state.resetEmail || '').trim()
  const password = String(data.get('password') || '')
  const code = String(data.get('code') || '').trim()
  if (form.id === 'auth-forgot') state.resetEmail = email
  if ((form.id === 'auth-form' || form.id === 'auth-reset') && password.length < 15) {
    state.error = copy.auth.weakPassword
    render()
    return
  }
  state.busy = true
  state.error = ''
  render()
  try {
    const { confirmSignIn, beginSignIn, logIn, sendPasswordReset, finishPasswordReset } = await authModule()
    if (form.id === 'auth-forgot') {
      await sendPasswordReset(key, email)
      state.busy = false
      state.authStep = 'reset'
      render()
      return
    }
    if (form.id === 'auth-reset') {
      await finishPasswordReset(key, code, password)
    } else if (form.id === 'auth-code') {
      await confirmSignIn(key, code)
    } else if (parse(location.pathname).name === 'join') {
      const step = await beginSignIn(key, email, password)
      if (step === 'code') {
        state.busy = false
        state.authStep = 'code'
        render()
        return
      }
    } else {
      await logIn(key, email, password)
    }
    window.location.assign(safeNext() || '/')
  } catch (error) {
    state.busy = false
    const { clerkMessage } = await authModule().catch(() => ({ clerkMessage: (e) => e?.message || copy.errors.generic }))
    const code = error?.errors?.[0]?.code || ''
    state.error = form.id === 'auth-forgot' && code === 'form_identifier_not_found'
      ? copy.auth.unknownEmail
      : clerkMessage(error)
    render()
  }
}

function paintPerson(resume, fields) {
  if (!resume) return resume
  const github = (resume.contact || []).find((item) => /^github\.com\//i.test(String(item)))
  const contact = [fields.email, fields.location, github].filter(Boolean)
  const lines = (value) => String(value || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 6)
  const edits = new Map((fields.work || state.current?.resume?.work || []).map((item) => [item.title, item.lines]))
  const work = (resume.work || []).map((item) => {
    const next = edits.get(item.title)
    return Array.isArray(next) ? { ...item, lines: next } : item
  })
  return {
    ...resume,
    name: fields.displayName || resume.name || '',
    headline: fields.headline || '',
    contact,
    education: lines(fields.education),
    experience: lines(fields.experience),
    work,
  }
}

function personOnly(next, link) {
  if (!next || !link) return false
  const repos = [...new Set(next.repos || [])].join('\n')
  const current = [...(link.selectedRepos || [])].join('\n')
  return repos === current
    && (next.visibility || 'public') === (link.visibility || 'public')
    && (next.roleTarget || '') === (link.roleTarget || '')
    && (next.instructions || '') === (link.instructions || '')
}

function rememberLocal(body) {
  if (!state.me?.account) return
  state.me.account = {
    ...state.me.account,
    name: body.displayName || '',
    headline: body.headline || '',
    location: body.location || '',
  }
}

let personTimer = 0
let rolePickTimer = 0

function previewEditor(form) {
  if (!state.current?.resume) return
  const body = readEditor(form)
  state.form = body
  state.current = {
    ...state.current,
    displayName: body.displayName,
    headline: body.headline,
    email: body.email,
    location: body.location,
    education: body.education,
    experience: body.experience,
    resume: paintPerson(state.current.resume, body),
  }
  const slot = document.querySelector('#paper-slot')
  if (slot && !state.editing) {
    slot.innerHTML = paper(state.current.resume)
    schedulePaperLayout()
  }
  const title = document.querySelector('.split > div > h1')
  if (title) title.textContent = body.displayName || copy.name
}

function schedulePersonSave() {
  const route = parse(location.pathname)
  if (route.name !== 'detail' || !state.current) return
  const form = document.querySelector('#editor')
  if (!form) return
  const body = readEditor(form)
  if (!personOnly(body, state.current)) return
  clearTimeout(personTimer)
  personTimer = setTimeout(async () => {
    try {
      await api(`/api/links/${route.id}/person`, {
        method: 'PATCH',
        quiet: true,
        body: { ...body, work: state.current.resume?.work || [] },
      })
    } catch {
      // The page already shows the edit. A later save can try again.
    }
  }, 400)
}

document.addEventListener('input', (event) => {
  const line = event.target.closest('[data-work-line]')
  if (line && state.current?.resume) {
    const title = line.getAttribute('data-work-title')
    const index = Number(line.getAttribute('data-work-line'))
    const item = (state.current.resume.work || []).find((entry) => entry.title === title)
    if (item?.lines) item.lines[index] = line.value
    schedulePersonSave()
    return
  }
  const form = event.target.closest('#editor')
  if (!form) return
  const route = parse(location.pathname)
  if (event.target.name === 'roleTarget' && (route.name === 'detail' || route.name === 'studio')) {
    clearTimeout(rolePickTimer)
    rolePickTimer = setTimeout(() => {
      const body = readEditor(form)
      const scope = body.visibility === 'all' ? 'all' : 'public'
      const merged = mergeRoleRepos(scope, body.roleTarget, body.repos, { fillEmpty: false })
      if (merged.join('\n') === (body.repos || []).join('\n')) return
      state.form = { ...body, repos: merged }
      render()
    }, 350)
    return
  }
  if (route.name !== 'detail') return
  previewEditor(form)
  schedulePersonSave()
})

document.addEventListener('submit', async (event) => {
  const form = event.target
  if (form.id === 'start-form') {
    event.preventDefault()
    if (!state.me?.account && state.me?.signInReady) {
      go(`/sign-in?next=${encodeURIComponent('/start')}`)
      return
    }
    window.location.href = '/api/auth/github?visibility=all'
    return
  }
  if (form.id === 'guest-github-form') {
    event.preventDefault()
    window.location.href = '/api/auth/github?visibility=all'
    return
  }
  if (form.id === 'auth-form' || form.id === 'auth-code' || form.id === 'auth-forgot' || form.id === 'auth-reset') {
    event.preventDefault()
    await submitAuth(form)
    return
  }
  if (form.id !== 'editor') return
  event.preventDefault()
  const body = readEditor(form)
  const route = parse(location.pathname)
  state.form = body
  state.error = ''
  state.notice = ''
  if (route.name === 'detail' && personOnly(body, state.current)) {
    const previous = state.current
    state.current = {
      ...previous,
      displayName: body.displayName,
      headline: body.headline,
      email: body.email,
      location: body.location,
      education: body.education,
      experience: body.experience,
      resume: paintPerson(previous.resume, { ...body, work: previous.resume?.work }),
    }
    state.notice = copy.notice.saved
    render()
    try {
      const saved = await api(`/api/links/${route.id}/person`, {
        method: 'PATCH',
        quiet: true,
        body: { ...body, work: state.current.resume?.work || [] },
      })
      state.current = { ...state.current, ...saved }
      rememberLocal(body)
    } catch (error) {
      state.current = previous
      state.form = formFromLink(previous)
      state.notice = ''
      state.error = error.message
    }
    render()
    return
  }
  state.busy = true
  render()
  try {
    if (route.name === 'studio') {
      const created = await api('/api/links', { method: 'POST', body, noRetry: true })
      rememberLocal(body)
      state.busy = false
      state.linksStamp = ''
      go(`/links/${created.id}`)
      return
    }
    const link = await api(`/api/links/${route.id}`, { method: 'PATCH', body })
    rememberLocal(body)
    state.current = link
    state.busy = false
    state.notice = copy.notice.saved
    render()
    if (link.status === 'preparing') watch(link.id, ++state.watchToken)
  } catch (error) {
    state.busy = false
    state.error = error.message
    render()
  }
})

window.addEventListener('popstate', () => {
  state.watchToken += 1
  state.authStep = 'details'
  state.error = ''
  render()
})

window.addEventListener('focus', () => {
  if (!projectsLoadStuck()) return
  state.projectsLoading = false
  state.projectsLoadedFor = ''
  maybeLoadProjects()
})

window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return
  state.projectsLoadedFor = ''
  refreshMe().then(() => {
    render()
    maybeLoadProjects()
  })
})

let paperResizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(paperResizeTimer)
  paperResizeTimer = setTimeout(() => {
    if (!state.editing) schedulePaperLayout()
  }, 120)
})

boot()
