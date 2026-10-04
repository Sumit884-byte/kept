import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const done = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

test('a sample link is written from tiger history', async (t) => {
  process.env.TIGER_DATABASE_URL = process.env.TIGER_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/current'
  process.env.APP_SECRET = process.env.APP_SECRET || 'test-secret'
  process.env.NODE_ENV = 'test'
  process.env.PUBLIC_URL = 'http://127.0.0.1:3000'
  const up = await canConnect(5433)
  if (!up) {
    t.skip('Tiger Data is not running on port 5433')
    return
  }
  const db = await import('../src/db.js')
  const { buildApp } = await import('../src/server.js')
  await db.migrate()
  await db.migrate()
  const names = await db.hypertableNames()
  assert.ok(names.includes('project_signals'))
  assert.ok(names.includes('code_readings'))
  const app = buildApp()
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  let accountId = ''
  try {
    const preview = await fetch(`${base}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(preview.status, 201)
    const cookie = (preview.headers.getSetCookie?.() || []).find((line) => line.startsWith('kept_session='))
    assert.ok(cookie)
    const session = cookie.split(';')[0]
    const headers = { 'Content-Type': 'application/json', Cookie: session }
    const projects = await fetch(`${base}/api/projects?visibility=all`, { headers }).then((res) => res.json())
    assert.equal(projects.projects.length, 2)
    assert.ok(projects.projects.some((project) => project.private))
    const created = await fetch(`${base}/api/links`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        visibility: 'all',
        displayName: 'Mira Chen',
        headline: 'Product engineer',
        email: 'mira@example.com',
        location: 'Lisbon',
        roleTarget: 'Product engineer',
        instructions: 'Lead with the work people can see.',
        repos: projects.projects.map((project) => project.fullName),
      }),
    })
    assert.equal(created.status, 201)
    const first = await created.json()
    let ready = first
    for (let i = 0; i < 20 && ready.status === 'preparing'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      ready = await fetch(`${base}/api/links/${first.id}`, { headers }).then((res) => res.json())
    }
    assert.equal(ready.status, 'ready', ready.lastError)
    assert.ok(ready.localReads.some((item) => item.fullName === 'northwind/parcel'))
    assert.equal(JSON.stringify(ready.localReads).includes('app.listen'), false)
    const before = JSON.stringify(ready.resume)
    assert.doesNotMatch(before, /drafts/)
    assert.doesNotMatch(before, /app\.listen/)
    const rejected = await fetch(`${base}/api/links/${first.id}/local`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        readings: [{ fullName: 'northwind/parcel', conclusion: 'app.listen(3000) starts the service now' }],
      }),
    })
    assert.equal(rejected.status, 400)
    const reader = await fetch(`${base}/api/github/reader`, { headers }).then((res) => res.json())
    assert.equal(reader.preview, true)
    assert.equal(reader.token, undefined)
    const local = await fetch(`${base}/api/links/${first.id}/local`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        readings: [{
          fullName: 'northwind/parcel',
          conclusion: 'Parcel is a web service. It handles drafts, send, and reminders.',
        }],
      }),
    })
    assert.equal(local.status, 200)
    ready = await local.json()
    assert.equal(ready.localReads.length, 0)
    const text = JSON.stringify(ready.resume)
    assert.match(text, /drafts/)
    assert.match(text, /from 12 to 40/)
    assert.match(text, /120 shops/)
    assert.doesNotMatch(text, /app\.listen/)
    assert.ok(ready.trendNotes.some((note) => note.includes('12') && note.includes('40')))
    const pdf = await fetch(`${base}/r/${ready.slug}.pdf`)
    assert.equal(pdf.headers.get('content-type'), 'application/pdf')
    const bytes = Buffer.from(await pdf.arrayBuffer())
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    const page = await fetch(`${base}/r/${ready.slug}`)
    const html = await page.text()
    assert.match(html, /Mira Chen/)
    assert.match(html, /Open the PDF/)
    const sample = await fetch(`${base}/sample`, { redirect: 'manual' })
    assert.equal(sample.status, 302)
    const location = sample.headers.get('location')
    assert.match(location, /^\/r\/[a-z0-9]{10}$/)
    const samplePage = await fetch(`${base}${location}`)
    const sampleHtml = await samplePage.text()
    assert.match(sampleHtml, /Mira Chen/)
    assert.match(sampleHtml, /Open the PDF/)
    const again = await fetch(`${base}/sample`, { redirect: 'manual' })
    assert.equal(again.headers.get('location'), location)
    const row = await db.query('SELECT account_id FROM links WHERE id = $1', [first.id])
    accountId = row.rows[0].account_id
  } finally {
    const sampleAccount = await db.query(`SELECT id FROM accounts WHERE github_id = 'preview:sample'`)
    const ids = [accountId, sampleAccount.rows[0]?.id].filter(Boolean)
    for (const id of ids) {
      await db.query('DELETE FROM project_signals WHERE link_id IN (SELECT id FROM links WHERE account_id = $1)', [id])
      await db.query('DELETE FROM code_readings WHERE link_id IN (SELECT id FROM links WHERE account_id = $1)', [id])
      await db.query('DELETE FROM link_updates WHERE link_id IN (SELECT id FROM links WHERE account_id = $1)', [id])
      await db.query('DELETE FROM accounts WHERE id = $1', [id])
    }
    await new Promise((resolve) => server.close(resolve))
    await db.close()
  }
})
