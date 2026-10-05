import { config } from './config.js'
import { copy } from './copy.js'
import { decrypt } from './cryptoBox.js'
import * as db from './db.js'
import { GithubError, ensureHook, gatherRepo, listPulls, profileName, profileReadme } from './github.js'
import { interpret } from './analyze.js'
import { cleanConclusion } from './public/gemmaText.js'
import { composeResume } from './resume.js'
import { tailorResume } from './tailor.js'
import { findSample, samplePerson } from './sample.js'

const inflight = new Map()

async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function humanError(error) {
  if (error instanceof GithubError) {
    if (error.status === 401) return copy.errors.githubAgain
    if (error.status === 403 || error.status === 429) return copy.errors.githubLimited
    if (error.status === 404) return copy.errors.projectMissing
  }
  if (error?.message === 'empty') return copy.errors.nothingYet
  return copy.errors.readFailed
}

async function personNotes(account) {
  if (account.preview) {
    return { profileText: samplePerson.profileReadme || '', pulls: samplePerson.pulls || [] }
  }
  if (!account.token_ciphertext || !account.login) return { profileText: account.profile_readme || '', pulls: [] }
  try {
    const token = decrypt(account.token_ciphertext)
    const [readme, pulls] = await Promise.all([
      profileReadme(token, account.login).catch(() => ''),
      listPulls(token, account.login).catch(() => []),
    ])
    const profileText = readme || account.profile_readme || ''
    if (readme && readme !== account.profile_readme) await db.setProfileReadme(account.id, readme)
    return { profileText, pulls }
  } catch (error) {
    console.error('profile notes failed', error.message)
    return { profileText: account.profile_readme || '', pulls: [] }
  }
}

async function saveGathered(id, account, reason) {
  const fresh = await db.getLink(id)
  if (!fresh) return
  const projects = await db.loadContext(fresh)
  if (!projects.length) return
  await writeResume(fresh, account, projects, reason)
}

async function writeResume(link, account, projects, reason) {
  const notes = await personNotes(account)
  const person = {
    name: profileName(link.display_name, account.login) || profileName(account.name, account.login) || '',
    email: link.email || account.email || '',
    location: link.location || account.location || '',
    blog: account.preview ? '' : (account.blog || ''),
    login: account.preview ? '' : account.login,
    bio: account.bio || '',
  }
  const prefs = {
    roleTarget: link.role_target || '',
    instructions: link.instructions || '',
    headline: link.headline || '',
    education: link.education || '',
    experience: link.experience || '',
    profileText: notes.profileText,
    pulls: notes.pulls,
  }
  const composed = composeResume({ person, projects, prefs })
  const tailored = await tailorResume(composed, projects, prefs)
  await db.setResume(link.id, tailored)
  await db.addUpdate(link.id, reason)
}

function gatheredFor(sample) {
  if (!sample.gather.repo.private) return sample.gather
  return {
    ...sample.gather,
    files: [],
    filePaths: (sample.gather.files || []).map((file) => file.path),
  }
}

async function refreshSample(link, fullName, mode) {
  const sample = findSample(fullName)
  if (!sample) throw new GithubError('missing', 404)
  const existing = await db.latestSignalTime(link.id, fullName)
  if (existing && mode !== 'full') return false
  if (!existing && sample.earlier) {
    const interpreted = interpret(gatheredFor(sample))
    await db.insertSignal({
      time: new Date(Date.now() - 90 * 86400000),
      linkId: link.id,
      fullName,
      signal: {
        ...interpreted.signal,
        stars: sample.earlier.stars,
        forks: sample.earlier.forks,
        openIssues: sample.earlier.openIssues,
      },
    })
  }
  if (existing) return true
  const interpreted = interpret(gatheredFor(sample))
  const now = new Date()
  await db.insertSignal({ time: now, linkId: link.id, fullName, signal: interpreted.signal })
  await db.insertReading({ time: now, linkId: link.id, fullName, reading: interpreted.reading })
  await db.touchWatch(link.id, fullName, {
    etag: 'sample',
    lastPushAt: sample.gather.repo.pushedAt,
    hookId: null,
  })
  return true
}

async function refreshGithub(link, account, fullName, watched, mode) {
  const token = decrypt(account.token_ciphertext)
  const etag = mode === 'check' ? watched?.etag : undefined
  const gathered = await gatherRepo(token, fullName, etag)
  if (gathered.notModified) return false
  if (
    mode === 'check'
    && watched?.last_push_at
    && gathered.pushedAt
    && new Date(gathered.pushedAt).getTime() <= new Date(watched.last_push_at).getTime()
  ) {
    await db.touchWatch(link.id, fullName, { etag: gathered.etag, lastPushAt: gathered.pushedAt, hookId: watched.hook_id })
    return false
  }
  const interpreted = interpret(gathered)
  if (interpreted.reading.detail.needsLocal) {
    const previous = await db.latestReading(link.id, fullName)
    if (previous?.detail?.reader === 'gemma' && previous.conclusion) {
      interpreted.reading.conclusion = previous.conclusion
      interpreted.reading.detail.reader = 'gemma'
      interpreted.reading.detail.needsLocal = true
    }
  }
  const now = new Date()
  await db.insertSignal({ time: now, linkId: link.id, fullName, signal: interpreted.signal })
  await db.insertReading({ time: now, linkId: link.id, fullName, reading: interpreted.reading })
  let hookId = watched?.hook_id || null
  if (link.visibility === 'all' && account.can_read_private && !hookId) {
    try {
      hookId = await ensureHook(token, fullName)
    } catch (error) {
      console.error('hook skipped', error.status || error.message)
    }
  }
  await db.touchWatch(link.id, fullName, {
    etag: gathered.etag,
    lastPushAt: gathered.pushedAt,
    hookId,
  })
  return true
}

async function runRefresh(id, opts) {
  const mode = opts.mode || 'full'
  const link = await db.getLink(id)
  if (!link) return { changed: false }
  const account = await db.getAccount(link.account_id)
  if (!account) return { changed: false }
  if (mode === 'check' && opts.respectPoll && link.last_polled_at && link.status !== 'preparing') {
    const age = Date.now() - new Date(link.last_polled_at).getTime()
    if (age < config.pollMs) return { changed: false, skipped: true }
  }
  if (mode === 'check') await db.markPolled(link.id)

  try {
    if (mode === 'reword') {
      const projects = await db.loadContext(link)
      if (!projects.length) throw new Error('empty')
      await writeResume(link, account, projects, opts.reason || copy.reasons.reword)
      return { changed: true }
    }

    const watched = await db.watchedMap(link.id)
    const repos = link.selected_repos || []
    let finished = 0
    let wroteCount = 0
    let saving = Promise.resolve()
    const reason = opts.reason || copy.reasons.first
    function noteProgress(wrote) {
      finished += 1
      if (wrote) wroteCount += 1
      if (!wroteCount || (wroteCount !== 1 && finished % 8 !== 0)) return
      saving = saving.then(() => saveGathered(id, account, reason)).catch((error) => {
        console.error('resume save failed', error.message)
      })
    }
    const outcomes = await mapLimit(repos, 4, async (fullName) => {
      try {
        const wrote = account.preview
          ? await refreshSample(link, fullName, mode)
          : await refreshGithub(link, account, fullName, watched.get(fullName), mode)
        noteProgress(wrote)
        return { wrote }
      } catch (error) {
        console.error('project refresh failed', error.status || error.message)
        noteProgress(false)
        return { error }
      }
    })
    await saving
    const failures = outcomes.filter((item) => item.error).map((item) => item.error)
    const wroteNew = outcomes.some((item) => item.wrote)
    if ((link.selected_repos || []).length && failures.length === link.selected_repos.length) throw failures[0]
    const fresh = await db.getLink(id)
    const projects = await db.loadContext(fresh)
    const needsWrite = !fresh?.resume || fresh.status === 'preparing'
    if (projects.length && (wroteNew || needsWrite)) {
      await writeResume(fresh, account, projects, reason)
      if (failures.length) await db.setError(id, copy.errors.partial)
      return { changed: true }
    }
    if (needsWrite && !projects.length) {
      await db.setError(id, copy.errors.nothingYet)
      return { changed: false, error: true }
    }
    return { changed: false }
  } catch (error) {
    console.error('refresh failed', error.message)
    await db.setError(id, humanError(error))
    return { changed: false, error: true }
  }
}

export async function applyLocalReadings(id, readings) {
  const link = await db.getLink(id)
  if (!link) return null
  const account = await db.getAccount(link.account_id)
  if (!account) return null
  const allowed = new Set(link.selected_repos || [])
  let changed = false
  for (const item of readings) {
    if (!allowed.has(item.fullName)) continue
    const previous = await db.latestReading(link.id, item.fullName)
    const storedName = previous?.detail?.displayName || ''
    const open = previous?.detail?.needsLocal || (previous?.detail?.reader === 'gemma' && !cleanConclusion(previous.conclusion, storedName))
    if (!previous?.detail?.private || !open) continue
    if (!cleanConclusion(item.conclusion, storedName)) continue
    const detail = { ...previous.detail, needsLocal: false, reader: 'gemma' }
    delete detail.files
    delete detail.source
    delete detail.text
    await db.insertReading({
      time: new Date(),
      linkId: link.id,
      fullName: item.fullName,
      reading: {
        readmeWasThin: previous.readme_was_thin,
        conclusion: item.conclusion,
        detail,
      },
    })
    changed = true
  }
  if (!changed) return db.getLink(id)
  const fresh = await db.getLink(id)
  const projects = await db.loadContext(fresh)
  await writeResume(fresh, account, projects, copy.reasons.local)
  return db.getLink(id)
}

export function refreshLink(id, opts = {}) {
  const existing = inflight.get(id)
  if (existing) return existing
  const run = runRefresh(id, opts).finally(() => inflight.delete(id))
  inflight.set(id, run)
  return run
}
