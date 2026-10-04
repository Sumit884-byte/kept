import { copy } from '/copy.js'
import { readPrivateLocally } from './privateRead.js'
import { beginSignIn, clerkMessage, confirmSignIn, continueWithGoogle, finishGoogleRedirect, loadClerk, logIn } from './auth.js'

const state = {
  me: null,
  example: null,
  form: null,
  projects: [],
  projectsFor: '',
  projectsLoading: false,
  needPrivate: false,
  projectsError: '',
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || copy.errors.generic)
    error.status = response.status
    throw error
  }
  return data
}

function safeNext() {
  const next = new URLSearchParams(location.search).get('next') || ''
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/api')) return ''
  return next
}

function authPath(path) {
  const next = safeNext()
  return next ? `${path}?next=${encodeURIComponent(next)}` : path
}

function makePath() {
  const account = state.me?.account
  if (account?.preview || account?.githubConnected) return '/studio'
  if (account) return '/start'
  if (state.me?.signInReady) return `/sign-in?next=${encodeURIComponent('/start')}`
  return '/start'
}

function go(path) {
  history.pushState({}, '', path)
  state.error = ''
  state.notice = path === '/links' ? state.notice : ''
  state.confirmRemove = false
  state.authStep = 'details'
  if (path === '/studio') {
    state.form = blankForm(state.me?.account)
    state.projectsOpen = false
    state.projectsFor = ''
    state.current = null
  }
  render()
}

function paper(resume) {
  if (!resume) return ''
  const contact = (resume.contact || []).map((item) => `<span>${esc(item)}</span>`).join('')
  const work = (resume.work || []).map((item) => `
    <section>
      <h3>${esc(item.title)}${item.stars > 0 ? `<span class="star-count">${esc(starCount(item.stars))}</span>` : ''}</h3>
      ${item.url ? `<p class="paper-url">${esc(item.url)}</p>` : ''}
      <ul>${(item.lines || []).map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
    </section>`).join('')
  return `<article class="paper">
    <h2 class="paper-name">${esc(resume.name)}</h2>
    ${contact ? `<p class="paper-contact">${contact}</p>` : ''}
    ${resume.headline ? `<p class="paper-line">${esc(resume.headline)}</p>` : ''}
    ${resume.summary ? `<p class="paper-summary">${esc(resume.summary)}</p>` : ''}
    ${(resume.education || []).length ? `<h2>${esc(copy.pdf.education)}</h2><ul class="paper-education">${resume.education.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
    ${resume.skills?.length ? `<h2>${esc(copy.pdf.skills)}</h2><p class="paper-skills">${esc(resume.skills.join(', '))}</p>` : ''}
    ${work ? `<h2>${esc(copy.pdf.selectedWork)}</h2>${work}` : ''}
    ${(resume.contributions || []).length ? `<h2>${esc(copy.pdf.contributions)}</h2>${resume.contributions.map((item) => `<section><h3>${esc(item.title || '')}</h3>${item.url ? `<p class="paper-url">${esc(item.url)}</p>` : ''}<ul><li>${esc(item.line)}</li></ul></section>`).join('')}` : ''}
  </article>`
}

function header() {
  const account = state.me?.account
  const right = account
    ? `<a href="/links" data-go="/links">${esc(copy.nav.links)}</a>
       <a href="${account.preview || account.githubConnected ? '/studio' : '/start'}" data-go="${account.preview || account.githubConnected ? '/studio' : '/start'}">${esc(copy.nav.newLink)}</a>
       <button type="button" data-action="logout">${esc(account.clerk ? copy.nav.signOut : copy.nav.disconnect)}</button>`
    : `<a href="/sign-in" data-go="/sign-in">${esc(copy.nav.login)}</a>
       <a class="button" href="/join" data-go="/join">${esc(copy.nav.signIn)}</a>`
  return `<a class="mark" href="/" data-go="/"><img class="mark-icon" src="/favicon.svg" alt="">${esc(copy.name)}</a><nav>${right}</nav>`
}

function banner() {
  const params = new URLSearchParams(location.search)
  const notice = params.get('notice')
  const denied = notice === 'denied' ? copy.errors.denied : ''
  const setup = notice === 'setup' ? copy.errors.notReady : ''
  const taken = notice === 'taken' ? copy.auth.taken : ''
  const message = state.error || denied || setup || taken
  const good = state.notice
  return `${message ? `<p class="banner" role="alert">${esc(message)}</p>` : ''}${good ? `<p class="ok" role="status">${esc(good)}</p>` : ''}`
}

function viewHome() {
  return `<section class="hero">
    <div>
      <p class="eyebrow">${esc(copy.home.eyebrow)}</p>
      <h1>${esc(copy.home.title)}</h1>
      <p class="lede">${esc(copy.home.lede)}</p>
      <div class="actions">
        <a class="button" href="${makePath()}" data-go="${makePath()}">${esc(copy.home.make)}</a>
        <a class="secondary button" href="/sample">${esc(copy.home.example)}</a>
      </div>
      <ol class="steps">
        ${copy.home.steps.map((step) => `<li><strong>${esc(step.n)}</strong><div><strong>${esc(step.title)}</strong><span>${esc(step.body)}</span></div></li>`).join('')}
      </ol>
      <p class="quiet trust">${esc(copy.home.trust)}</p>
    </div>
    <div class="stage">
      <div class="paper-back" aria-hidden="true"></div>
      ${paper(state.example)}
    </div>
  </section>`
}

function viewStart() {
  const practice = state.me?.practice && !state.me?.account
    ? `<button class="button secondary" type="button" data-action="practice" ${state.busy ? 'disabled' : ''}>${esc(copy.start.practice)}</button>`
    : ''
  const ready = state.me?.githubReady
  const signedIn = Boolean(state.me?.account && !state.me.account.preview)
  const loginFirst = `/sign-in?next=${encodeURIComponent('/start')}`
  const connect = ready
    ? (signedIn || !state.me?.signInReady
      ? `<button class="button" type="submit">${esc(copy.start.connect)}</button>`
      : `<a class="button" href="${loginFirst}" data-go="${loginFirst}">${esc(copy.nav.login)}</a>`)
    : `<p class="quiet">${esc(copy.start.notReady)}</p>`
  return `<section class="panel">
    <h1>${esc(copy.start.title)}</h1>
    <p class="lede">${esc(copy.start.lede)}</p>
    ${banner()}
    <form id="start-form" class="choice-row">
      <label class="choice is-on">
        <input type="radio" name="visibility" value="public" checked>
        <span><strong>${esc(copy.start.publicTitle)}</strong>${esc(copy.start.publicBody)}</span>
      </label>
      <label class="choice">
        <input type="radio" name="visibility" value="all">
        <span><strong>${esc(copy.start.allTitle)}</strong>${esc(copy.start.allBody)}</span>
      </label>
      <div class="actions">
        ${connect}
        ${practice}
      </div>
    </form>
  </section>`
}

function googleMark() {
  return `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.16.29-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.03l2.99-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/></svg>`
}

function viewAuth(mode) {
  const joining = mode === 'join'
  const ready = state.me?.signInReady
  const loginHref = authPath('/sign-in')
  const joinHref = authPath('/join')
  const codeStep = joining && state.authStep === 'code'
  const title = codeStep ? copy.auth.code : (joining ? copy.auth.signInTitle : copy.auth.loginTitle)
  const lede = codeStep ? copy.auth.codeLede : (joining ? copy.auth.signInLede : copy.auth.loginLede)
  const fields = codeStep
    ? `<label class="field"><span>${esc(copy.auth.code)}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>`
    : `<label class="field"><span>${esc(copy.auth.email)}</span><input name="email" type="email" autocomplete="email" required></label>
       <label class="field"><span>${esc(copy.auth.password)}</span><input name="password" type="password" autocomplete="${joining ? 'new-password' : 'current-password'}" required></label>`
  const button = codeStep ? copy.auth.confirm : (joining ? copy.nav.signIn : copy.nav.login)
  const google = codeStep ? '' : `<button class="button google" type="button" data-action="google" ${!ready || state.busy ? 'disabled' : ''}>${googleMark()}<span>${esc(copy.auth.google)}</span></button><p class="auth-or">${esc(copy.auth.or)}</p>`
  return `<section class="panel">
    <div class="auth-switch" role="tablist">
      <a href="${loginHref}" data-go="${loginHref}" class="${joining ? '' : 'is-on'}" role="tab" aria-selected="${joining ? 'false' : 'true'}">${esc(copy.nav.login)}</a>
      <a href="${joinHref}" data-go="${joinHref}" class="${joining ? 'is-on' : ''}" role="tab" aria-selected="${joining ? 'true' : 'false'}">${esc(copy.nav.signIn)}</a>
    </div>
    <h1>${esc(title)}</h1>
    <p class="lede">${esc(lede)}</p>
    ${banner()}
    ${ready ? '' : `<p class="quiet">${esc(copy.auth.notReady)}</p>`}
    <form id="${codeStep ? 'auth-code' : 'auth-form'}" class="auth-form">
      ${google}
      ${fields}
      <div id="clerk-captcha"></div>
      <div class="actions">
        <button class="button" type="submit" ${!ready || state.busy ? 'disabled' : ''}>${esc(state.busy ? copy.loading : button)}</button>
      </div>
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
    <label class="field"><span>${esc(copy.studio.education)}</span><textarea name="education" placeholder="${esc(copy.studio.educationPlaceholder)}">${esc(values.education || '')}</textarea></label>
    <p class="help">${esc(copy.studio.educationHelp)}</p>`
}

function projectsInScope(visibility) {
  return state.projects.filter((project) => visibility === 'all' || !project.private)
}

function projectList(selected, visibility) {
  const chosen = new Set(selected || [])
  if (state.projectsLoading || !state.projectsFor) return `<p class="quiet">${esc(copy.loading)}</p>`
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
        ${on ? `<div class="choice-tools">
          <button class="text-button" type="button" data-action="toggle-projects">${esc(state.projectsOpen ? copy.studio.hideProjects : copy.studio.leaveSome)}</button>
          ${projectsInScope(value).some((project) => project.fork) ? `<button class="text-button" type="button" data-action="leave-forks">${esc(copy.studio.leaveForks)}</button>` : ''}
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
    ${banner()}
    <form id="editor">
      ${fields(values)}
      <h2 class="section-label">${esc(copy.studio.projects)}</h2>
      <p class="help">${esc(copy.studio.projectsHelp)}</p>
      ${projectChoices(values)}
      ${briefFields(values)}
      <button class="button" type="submit" ${state.busy ? 'disabled' : ''}>${esc(state.busy ? copy.studio.creating : copy.studio.create)}</button>
    </form>
  </section>`
}

function viewLinks() {
  if (!state.links.length) {
    return `<section class="list-page"><h1>${esc(copy.links.title)}</h1>${banner()}<p class="lede">${esc(copy.links.empty)}</p><a class="button" href="/studio" data-go="/studio">${esc(copy.nav.newLink)}</a></section>`
  }
  return `<section class="list-page">
    <h1>${esc(copy.links.title)}</h1>
    ${banner()}
    <div class="cards">
      ${state.links.map((link) => `<a class="card" href="/links/${esc(link.id)}" data-go="/links/${esc(link.id)}">
        <span><strong>${esc(link.roleTarget)}</strong><small class="quiet">${esc(link.refreshedLabel || link.lastError || '')}</small></span>
        <span>${esc(copy.links.open)}</span>
      </a>`).join('')}
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
    return `<section class="panel wait">
      <h1>${esc(copy.detail.waiting)}</h1>
      <div class="wait-bar" aria-hidden="true"><span></span></div>
    </section>`
  }
  if (!link.resume) {
    return `<section class="panel">${banner()}<p class="banner">${esc(link.lastError || copy.errors.readFailed)}</p>
      <button class="button" type="button" data-action="refresh">${esc(copy.detail.check)}</button></section>`
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
      <p class="help">${esc(copy.detail.removeHelp)}</p>
      ${state.confirmRemove
        ? `<p>${esc(copy.detail.confirm)}</p><button class="button danger" type="button" data-action="remove">${esc(copy.detail.yesRemove)}</button>`
        : `<button class="button danger" type="button" data-action="ask-remove">${esc(copy.detail.remove)}</button>`}
    </div>
    <div>${paper(link.resume)}</div>
  </section>`
}

function viewMissing() {
  return `<section class="panel"><h1>${esc(copy.missing.title)}</h1><a href="/" data-go="/">${esc(copy.missing.home)}</a></section>`
}

function blankForm(account) {
  const params = new URLSearchParams(location.search)
  const visibility = params.get('visibility') === 'all' || account?.preview ? 'all' : 'public'
  return {
    displayName: account?.name || '',
    headline: account?.headline != null ? account.headline : (account?.bio || ''),
    email: account?.email || '',
    location: account?.location || '',
    education: '',
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

function render() {
  const route = parse(location.pathname)
  document.querySelector('#top').innerHTML = header()
  const main = document.querySelector('#main')
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
      finishGoogleRedirect(state.me.publishableKey).catch((error) => {
        state.callbackStarted = false
        state.error = clerkMessage(error)
        go('/sign-in')
      })
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
  const views = {
    home: viewHome,
    start: viewStart,
    'sign-in': () => viewAuth('login'),
    join: () => viewAuth('join'),
    studio: viewStudio,
    links: viewLinks,
    detail: viewDetail,
    missing: viewMissing,
  }
  main.innerHTML = (views[route.name] || viewMissing)()
  if ((route.name === 'sign-in' || route.name === 'join') && state.me?.publishableKey) {
    loadClerk(state.me.publishableKey).catch(() => {})
  }
  document.title = copy.name
  const editor = document.querySelector('#editor')
  if (route.name === 'studio' || route.name === 'detail') {
    const visibility = editor?.visibility?.value || state.form?.visibility || 'public'
    if (state.projectsFor !== visibility && !state.projectsLoading && state.me?.account) ensureProjects(visibility)
  }
  updateCount()
}

async function ensureProjects(visibility) {
  if (state.projectsLoading) return
  state.projectsFor = visibility
  state.projectsLoading = true
  render()
  try {
    const data = await api(`/api/projects?visibility=${encodeURIComponent(visibility)}`)
    state.projects = data.projects || []
    state.needPrivate = Boolean(data.needPrivate)
    state.needGithub = Boolean(data.needGithub)
    state.projectsError = ''
  } catch (error) {
    state.projectsError = error.message
    state.projects = []
    state.needGithub = false
  } finally {
    state.projectsLoading = false
    const editor = document.querySelector('#editor')
    if (editor) {
      const next = readEditor(editor)
      if (!editor.querySelector('input[name="repo"]')) next.repos = state.form?.repos || []
      const scope = next.visibility || visibility
      if (!state.projectsError && !state.needPrivate && !state.needGithub && (state.fillRepos || (state.filledFor !== scope && !next.repos.length))) {
        next.repos = projectsInScope(scope).map((project) => project.fullName)
        state.filledFor = scope
      }
      state.fillRepos = false
      state.form = next
    }
    render()
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
    if (state.projectsFor !== state.current.visibility) state.projectsFor = ''
    state.error = ''
  } catch (error) {
    state.current = null
    state.error = error.message
    document.querySelector('#main').innerHTML = `<section class="panel">${banner()}</section>`
    return
  }
  if (state.watchToken !== token) return
  render()
  if (state.current?.status === 'preparing') watch(id, token)
  else settlePrivate(state.current)
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
    let token = ''
    if (!state.me?.account?.preview) {
      const reader = await api('/api/github/reader')
      token = reader.token || ''
    }
    const readings = await readPrivateLocally(link.localReads, {
      preview: Boolean(state.me?.account?.preview),
      token,
    })
    if (!readings.length) throw new Error('empty')
    const updated = await api(`/api/links/${link.id}/local`, { method: 'POST', body: { readings } })
    if (state.current?.id === link.id) {
      state.current = updated
      state.form = formFromLink(updated)
    }
    state.privateNote = ''
  } catch {
    state.privateNote = ''
    if (state.current?.id === link.id) state.error = copy.detail.privateMissed
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

async function boot() {
  try {
    const [me, example] = await Promise.all([
      api('/api/me'),
      api('/api/example').catch(() => ({ resume: null })),
    ])
    state.me = me
    state.example = example.resume
    if (me.account) state.form = blankForm(me.account)
  } catch (error) {
    state.error = error.message
  }
  render()
}

document.addEventListener('click', async (event) => {
  const goLink = event.target.closest('[data-go]')
  if (goLink) {
    event.preventDefault()
    go(goLink.getAttribute('data-go'))
    return
  }
  const action = event.target.closest('[data-action]')?.getAttribute('data-action')
  if (!action) return
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
  if (action === 'google') {
    const key = state.me?.publishableKey
    if (!key) {
      state.error = copy.auth.notReady
      render()
      return
    }
    state.busy = true
    state.error = ''
    render()
    try {
      await continueWithGoogle(key, safeNext() || '/')
    } catch (error) {
      state.busy = false
      state.error = clerkMessage(error)
      render()
    }
    return
  }
  if (action === 'logout') {
    await api('/api/auth/logout', { method: 'POST', body: {} })
    state.me = { ...(state.me || {}), account: null }
    state.current = null
    state.linksStamp = ''
    go('/')
  }
  if (action === 'practice') {
    state.busy = true
    render()
    try {
      const data = await api('/api/preview', { method: 'POST', body: {} })
      state.me = { ...(state.me || {}), account: data.account, practice: true }
      state.form = blankForm(data.account)
      state.projectsFor = ''
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
    state.confirmRemove = true
    render()
  }
  if (action === 'remove') {
    const id = state.current?.id
    if (!id) return
    await api(`/api/links/${id}`, { method: 'DELETE' })
    state.current = null
    state.linksStamp = ''
    state.notice = copy.notice.removed
    go('/links')
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
      render()
      await settlePrivate(link)
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
    ensureProjects(state.form.visibility)
  }
  if (event.target.name === 'repo') updateCount()
})

async function submitAuth(form) {
  const key = state.me?.publishableKey
  if (!key) {
    state.error = copy.auth.notReady
    render()
    return
  }
  const data = new FormData(form)
  const email = String(data.get('email') || '').trim()
  const password = String(data.get('password') || '')
  const code = String(data.get('code') || '').trim()
  if (form.id === 'auth-form' && password.length < 8) {
    state.error = copy.auth.weakPassword
    render()
    return
  }
  state.busy = true
  state.error = ''
  render()
  try {
    if (form.id === 'auth-code') {
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
    state.error = clerkMessage(error)
    render()
  }
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

document.addEventListener('submit', async (event) => {
  const form = event.target
  if (form.id === 'start-form') {
    event.preventDefault()
    if (!state.me?.account && state.me?.signInReady) {
      go(`/sign-in?next=${encodeURIComponent('/start')}`)
      return
    }
    const visibility = new FormData(form).get('visibility') === 'all' ? 'all' : 'public'
    window.location.href = `/api/auth/github?visibility=${visibility}`
    return
  }
  if (form.id === 'auth-form' || form.id === 'auth-code') {
    event.preventDefault()
    await submitAuth(form)
    return
  }
  if (form.id !== 'editor') return
  event.preventDefault()
  const body = readEditor(form)
  state.form = body
  state.busy = true
  state.error = ''
  state.notice = ''
  render()
  try {
    const route = parse(location.pathname)
    if (route.name === 'studio') {
      const created = await api('/api/links', { method: 'POST', body })
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

boot()
