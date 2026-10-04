import pg from 'pg'
import { config } from './config.js'
import { applyHistory } from './history.js'
import { sessionId, slug } from './ids.js'

const { Pool } = pg

let pool
export const features = { timescale: false }

export function getPool() {
  if (!pool) {
    const url = config.tigerUrl
    const local = /localhost|127\.0\.0\.1/.test(url)
    pool = new Pool({
      connectionString: url,
      max: config.poolMax,
      application_name: 'kept',
      ssl: local ? false : { rejectUnauthorized: false },
    })
    pool.on('error', (error) => {
      console.error('tiger pool error', error.message)
    })
  }
  return pool
}

export async function query(text, params = []) {
  return getPool().query(text, params)
}

export async function close() {
  if (pool) await pool.end()
  pool = undefined
}

async function hypertable(name) {
  if (!features.timescale) return
  try {
    await query(`SELECT create_hypertable('${name}', 'time', if_not_exists => TRUE)`)
  } catch (error) {
    try {
      await query(`SELECT create_hypertable('${name}', by_range('time'), if_not_exists => TRUE)`)
    } catch (inner) {
      console.error(`hypertable ${name} was not created`, inner.message || error.message)
    }
  }
}

export async function migrate() {
  const client = await getPool().connect()
  try {
    await client.query('SELECT 1')
  } finally {
    client.release()
  }
  try {
    await query('CREATE EXTENSION IF NOT EXISTS timescaledb')
  } catch (error) {
    console.error('timescaledb extension was not created', error.message)
  }
  const extension = await query(`SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`)
  features.timescale = extension.rowCount > 0

  await query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY,
      github_id TEXT UNIQUE NOT NULL,
      login TEXT NOT NULL,
      name TEXT,
      email TEXT,
      avatar_url TEXT,
      bio TEXT,
      blog TEXT,
      location TEXT,
      token_ciphertext TEXT NOT NULL,
      can_read_private BOOLEAN NOT NULL DEFAULT FALSE,
      preview BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS clerk_user_id TEXT`)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_clerk_user ON accounts (clerk_user_id)`)
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS links (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      slug TEXT UNIQUE NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'all')),
      display_name TEXT,
      headline TEXT,
      email TEXT,
      location TEXT,
      role_target TEXT,
      instructions TEXT,
      selected_repos TEXT[] NOT NULL DEFAULT '{}',
      resume JSONB,
      status TEXT NOT NULL DEFAULT 'preparing',
      last_error TEXT,
      last_refreshed_at TIMESTAMPTZ,
      last_polled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS watched_repos (
      link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      hook_id BIGINT,
      last_push_at TIMESTAMPTZ,
      etag TEXT,
      PRIMARY KEY (link_id, full_name)
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS project_signals (
      time TIMESTAMPTZ NOT NULL,
      link_id UUID NOT NULL,
      full_name TEXT NOT NULL,
      stars INTEGER,
      forks INTEGER,
      open_issues INTEGER,
      watchers INTEGER,
      commits_in_window INTEGER,
      additions INTEGER,
      deletions INTEGER,
      releases INTEGER,
      readme_score REAL,
      primary_language TEXT
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS code_readings (
      time TIMESTAMPTZ NOT NULL,
      link_id UUID NOT NULL,
      full_name TEXT NOT NULL,
      readme_was_thin BOOLEAN NOT NULL,
      conclusion TEXT NOT NULL,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS link_updates (
      time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      link_id UUID NOT NULL,
      reason TEXT NOT NULL
    )
  `)
  await hypertable('project_signals')
  await hypertable('code_readings')
  await hypertable('link_updates')
  await query(`CREATE INDEX IF NOT EXISTS project_signals_lookup ON project_signals (link_id, full_name, time DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS code_readings_lookup ON code_readings (link_id, full_name, time DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS link_updates_lookup ON link_updates (link_id, time DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS links_account ON links (account_id, updated_at DESC)`)
}

export async function upsertAccount(account) {
  const result = await query(
    `INSERT INTO accounts (
      id, github_id, login, name, email, avatar_url, bio, blog, location, token_ciphertext, can_read_private, preview, clerk_user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    )
    ON CONFLICT (github_id) DO UPDATE SET
      login = EXCLUDED.login,
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      avatar_url = EXCLUDED.avatar_url,
      bio = EXCLUDED.bio,
      blog = EXCLUDED.blog,
      location = EXCLUDED.location,
      token_ciphertext = EXCLUDED.token_ciphertext,
      can_read_private = EXCLUDED.can_read_private,
      clerk_user_id = COALESCE(EXCLUDED.clerk_user_id, accounts.clerk_user_id),
      updated_at = NOW()
    RETURNING *`,
    [
      crypto.randomUUID(),
      account.githubId,
      account.login,
      account.name || '',
      account.email || '',
      account.avatarUrl || '',
      account.bio || '',
      account.blog || '',
      account.location || '',
      account.tokenCiphertext,
      Boolean(account.canReadPrivate),
      Boolean(account.preview),
      account.clerkUserId || null,
    ],
  )
  return result.rows[0]
}

export async function getAccount(id) {
  const result = await query('SELECT * FROM accounts WHERE id = $1', [id])
  return result.rows[0] || null
}

export async function getAccountByClerkId(clerkUserId) {
  if (!clerkUserId) return null
  const result = await query('SELECT * FROM accounts WHERE clerk_user_id = $1', [clerkUserId])
  return result.rows[0] || null
}

export async function getAccountByGithubId(githubId) {
  if (!githubId) return null
  const result = await query('SELECT * FROM accounts WHERE github_id = $1', [githubId])
  return result.rows[0] || null
}

export async function attachGithub(id, account) {
  const result = await query(
    `UPDATE accounts SET
      github_id = $2,
      login = $3,
      name = COALESCE(NULLIF($4, ''), name),
      email = COALESCE(NULLIF($5, ''), email),
      avatar_url = $6,
      bio = $7,
      blog = $8,
      location = COALESCE(NULLIF($9, ''), location),
      token_ciphertext = $10,
      can_read_private = $11,
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      account.githubId,
      account.login,
      account.name || '',
      account.email || '',
      account.avatarUrl || '',
      account.bio || '',
      account.blog || '',
      account.location || '',
      account.tokenCiphertext,
      Boolean(account.canReadPrivate),
    ],
  )
  return result.rows[0] || null
}

export async function createSession(accountId) {
  const id = sessionId()
  await query(
    `INSERT INTO sessions (id, account_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '14 days')`,
    [id, accountId],
  )
  return id
}

export async function getSession(id) {
  if (!id) return null
  const result = await query('SELECT * FROM sessions WHERE id = $1 AND expires_at > NOW()', [id])
  return result.rows[0] || null
}

export async function deleteSession(id) {
  await query('DELETE FROM sessions WHERE id = $1', [id])
}

export async function createLink(accountId, fields) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await query(
        `INSERT INTO links (
          id, account_id, slug, visibility, display_name, headline, email, location, role_target, instructions, selected_repos, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'preparing')
        RETURNING *`,
        [
          crypto.randomUUID(),
          accountId,
          slug(),
          fields.visibility,
          fields.displayName || '',
          fields.headline || '',
          fields.email || '',
          fields.location || '',
          fields.roleTarget || '',
          fields.instructions || '',
          fields.repos,
        ],
      )
      return result.rows[0]
    } catch (error) {
      if (error.code !== '23505') throw error
    }
  }
  throw new Error('Could not reserve a link')
}

export async function updateLink(id, accountId, fields) {
  const map = {
    visibility: 'visibility',
    displayName: 'display_name',
    headline: 'headline',
    email: 'email',
    location: 'location',
    roleTarget: 'role_target',
    instructions: 'instructions',
    selectedRepos: 'selected_repos',
    status: 'status',
  }
  const sets = []
  const params = []
  for (const [key, column] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      params.push(fields[key])
      sets.push(`${column} = $${params.length}`)
    }
  }
  if (!sets.length) return getLinkForAccount(id, accountId)
  params.push(id, accountId)
  sets.push('updated_at = NOW()')
  const result = await query(
    `UPDATE links SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND account_id = $${params.length} RETURNING *`,
    params,
  )
  return result.rows[0] || null
}

export async function listLinks(accountId) {
  const result = await query(
    `SELECT id, slug, role_target, status, last_error, last_refreshed_at, updated_at, display_name, headline
     FROM links WHERE account_id = $1 ORDER BY updated_at DESC`,
    [accountId],
  )
  return result.rows
}

export async function getLink(id) {
  const result = await query('SELECT * FROM links WHERE id = $1', [id])
  return result.rows[0] || null
}

export async function getLinkForAccount(id, accountId) {
  const result = await query('SELECT * FROM links WHERE id = $1 AND account_id = $2', [id, accountId])
  return result.rows[0] || null
}

export async function getLinkBySlug(slugValue) {
  const result = await query('SELECT * FROM links WHERE slug = $1', [slugValue])
  return result.rows[0] || null
}

export async function deleteLink(id, accountId) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const owned = await client.query('SELECT id FROM links WHERE id = $1 AND account_id = $2', [id, accountId])
    if (!owned.rowCount) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query('DELETE FROM project_signals WHERE link_id = $1', [id])
    await client.query('DELETE FROM code_readings WHERE link_id = $1', [id])
    await client.query('DELETE FROM link_updates WHERE link_id = $1', [id])
    await client.query('DELETE FROM links WHERE id = $1', [id])
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function watchedMap(linkId) {
  const result = await query('SELECT * FROM watched_repos WHERE link_id = $1', [linkId])
  return new Map(result.rows.map((row) => [row.full_name, row]))
}

export async function touchWatch(linkId, fullName, { etag, lastPushAt, hookId }) {
  await query(
    `INSERT INTO watched_repos (link_id, full_name, hook_id, last_push_at, etag)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (link_id, full_name) DO UPDATE SET
       hook_id = COALESCE(EXCLUDED.hook_id, watched_repos.hook_id),
       last_push_at = EXCLUDED.last_push_at,
       etag = EXCLUDED.etag`,
    [linkId, fullName, hookId || null, lastPushAt || null, etag || null],
  )
}

export async function forgetUnselected(linkId, fullNames) {
  await query('DELETE FROM watched_repos WHERE link_id = $1 AND NOT (full_name = ANY($2::text[]))', [linkId, fullNames])
  await query('DELETE FROM project_signals WHERE link_id = $1 AND NOT (full_name = ANY($2::text[]))', [linkId, fullNames])
  await query('DELETE FROM code_readings WHERE link_id = $1 AND NOT (full_name = ANY($2::text[]))', [linkId, fullNames])
}

export async function linksForRepo(fullName) {
  const result = await query(
    `SELECT l.id
     FROM links l
     JOIN watched_repos w ON w.link_id = l.id
     JOIN accounts a ON a.id = l.account_id
     WHERE w.full_name = $1 AND a.preview = FALSE`,
    [fullName],
  )
  return result.rows.map((row) => row.id)
}

export async function linksDue(seconds) {
  const result = await query(
    `SELECT l.id
     FROM links l
     JOIN accounts a ON a.id = l.account_id
     WHERE a.preview = FALSE
       AND l.status = 'ready'
       AND (l.last_polled_at IS NULL OR l.last_polled_at < NOW() - make_interval(secs => $1))`,
    [seconds],
  )
  return result.rows.map((row) => row.id)
}

export async function markPolled(id) {
  await query('UPDATE links SET last_polled_at = NOW() WHERE id = $1', [id])
}

export async function latestSignalTime(linkId, fullName) {
  const result = await query(
    'SELECT time FROM project_signals WHERE link_id = $1 AND full_name = $2 ORDER BY time DESC LIMIT 1',
    [linkId, fullName],
  )
  return result.rows[0]?.time || null
}

export async function insertSignal({ time, linkId, fullName, signal }) {
  await query(
    `INSERT INTO project_signals (
      time, link_id, full_name, stars, forks, open_issues, watchers,
      commits_in_window, additions, deletions, releases, readme_score, primary_language
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      time,
      linkId,
      fullName,
      signal.stars,
      signal.forks,
      signal.openIssues,
      signal.watchers,
      signal.commits,
      signal.additions,
      signal.deletions,
      signal.releases,
      signal.readmeScore,
      signal.language || '',
    ],
  )
}

export async function latestReading(linkId, fullName) {
  const result = await query(
    `SELECT readme_was_thin, conclusion, detail
     FROM code_readings
     WHERE link_id = $1 AND full_name = $2
     ORDER BY time DESC
     LIMIT 1`,
    [linkId, fullName],
  )
  return result.rows[0] || null
}

export async function insertReading({ time, linkId, fullName, reading }) {
  await query(
    `INSERT INTO code_readings (time, link_id, full_name, readme_was_thin, conclusion, detail)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [time, linkId, fullName, reading.readmeWasThin, reading.conclusion, JSON.stringify(reading.detail || {})],
  )
}

export async function setResume(id, resume) {
  await query(
    `UPDATE links
     SET resume = $2::jsonb, status = 'ready', last_error = NULL, last_refreshed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(resume)],
  )
}

export async function setError(id, message) {
  await query(
    `UPDATE links
     SET status = CASE WHEN resume IS NULL THEN 'error' ELSE status END,
         last_error = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [id, message],
  )
}

export async function addUpdate(linkId, reason) {
  await query('INSERT INTO link_updates (time, link_id, reason) VALUES (NOW(), $1, $2)', [linkId, reason])
}

export async function latestReason(linkId) {
  const result = await query(
    'SELECT reason, time FROM link_updates WHERE link_id = $1 ORDER BY time DESC LIMIT 1',
    [linkId],
  )
  return result.rows[0] || null
}

function projectFrom(reading, signal) {
  const detail = reading.detail || {}
  const project = {
    fullName: reading.full_name,
    name: detail.displayName || reading.full_name.split('/').at(-1),
    url: detail.url || '',
    private: Boolean(detail.private),
    language: signal?.primary_language || '',
    description: detail.description || '',
    conclusion: reading.conclusion,
    highlights: detail.highlights || [],
    readmeWasThin: reading.readme_was_thin,
    needsLocal: Boolean(detail.needsLocal),
    reader: detail.reader || '',
    filePaths: Array.isArray(detail.filePaths) ? detail.filePaths : [],
    numbers: {
      days: 90,
      commits: signal?.commits_in_window || 0,
      additions: signal?.additions || 0,
      deletions: signal?.deletions || 0,
      complete: Boolean(detail.windowComplete),
      releases: signal?.releases || 0,
      latestRelease: detail.latestRelease || '',
      stars: signal?.stars || 0,
      forks: signal?.forks || 0,
      openIssues: signal?.open_issues || 0,
      stated: detail.stated || [],
    },
  }
  if (signal?.earlier_stars == null) return project
  return applyHistory(project, {
    stars: signal.earlier_stars,
    forks: signal.earlier_forks,
    openIssues: signal.earlier_issues,
  })
}

export async function loadContext(link) {
  const readings = await query(
    `SELECT DISTINCT ON (full_name) full_name, readme_was_thin, conclusion, detail
     FROM code_readings
     WHERE link_id = $1
     ORDER BY full_name, time DESC`,
    [link.id],
  )
  const signals = await query(
    `WITH latest AS (
       SELECT DISTINCT ON (full_name) *
       FROM project_signals
       WHERE link_id = $1
       ORDER BY full_name, time DESC
     )
     SELECT l.full_name, l.stars, l.forks, l.open_issues, l.commits_in_window, l.additions,
            l.deletions, l.releases, l.primary_language,
            e.stars AS earlier_stars, e.forks AS earlier_forks, e.open_issues AS earlier_issues
     FROM latest l
     LEFT JOIN LATERAL (
       SELECT stars, forks, open_issues
       FROM project_signals p
       WHERE p.link_id = l.link_id
         AND p.full_name = l.full_name
         AND p.time <= l.time - INTERVAL '1 hour'
       ORDER BY p.time DESC
       LIMIT 1
     ) e ON TRUE`,
    [link.id],
  )
  const readingBy = new Map(readings.rows.map((row) => [row.full_name, row]))
  const signalBy = new Map(signals.rows.map((row) => [row.full_name, row]))
  return (link.selected_repos || [])
    .map((fullName) => {
      const reading = readingBy.get(fullName)
      if (!reading) return null
      return projectFrom(reading, signalBy.get(fullName))
    })
    .filter(Boolean)
}

async function trendRows(linkId, timescale) {
  const sql = timescale
    ? `SELECT time_bucket('7 days', time) AS bucket, full_name, max(stars) AS stars
       FROM project_signals
       WHERE link_id = $1
       GROUP BY 1, full_name
       ORDER BY bucket ASC`
    : `SELECT date_trunc('week', time) AS bucket, full_name, max(stars) AS stars
       FROM project_signals
       WHERE link_id = $1
       GROUP BY 1, full_name
       ORDER BY bucket ASC`
  return query(sql, [linkId])
}

export async function trendNotes(linkId) {
  let buckets
  try {
    buckets = await trendRows(linkId, features.timescale)
  } catch (error) {
    if (!features.timescale) throw error
    buckets = await trendRows(linkId, false)
  }
  const readings = await query(
    `SELECT DISTINCT ON (full_name) full_name, detail
     FROM code_readings WHERE link_id = $1
     ORDER BY full_name, time DESC`,
    [linkId],
  )
  const names = new Map(readings.rows.map((row) => [row.full_name, row.detail?.displayName || row.full_name.split('/')[1]]))
  const grouped = new Map()
  for (const row of buckets.rows) {
    const list = grouped.get(row.full_name) || []
    list.push(row)
    grouped.set(row.full_name, list)
  }
  const notes = []
  for (const [fullName, list] of grouped) {
    if (list.length < 2) continue
    const first = Number(list[0].stars) || 0
    const last = Number(list[list.length - 1].stars) || 0
    if (last > first) notes.push(`People starring ${names.get(fullName) || 'a project'} went from ${first} to ${last}.`)
  }
  return notes
}

export async function hypertableNames() {
  if (!features.timescale) return []
  const result = await query('SELECT hypertable_name FROM timescaledb_information.hypertables')
  return result.rows.map((row) => row.hypertable_name)
}
