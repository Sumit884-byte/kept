import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.GITHUB_APP_ID = '12345'
process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).replace(/\n/g, '\\n')

const { appJwt, readerTokens, AppNotInstalled } = await import('../src/githubApp.js')

test('the app JWT is RS256-signed, short-lived and issued by the app id', () => {
  const [head, body, sig] = appJwt().split('.')
  const claims = JSON.parse(Buffer.from(body, 'base64url'))
  assert.equal(JSON.parse(Buffer.from(head, 'base64url')).alg, 'RS256')
  assert.equal(claims.iss, '12345')
  assert.ok(claims.exp - claims.iat <= 600)
  assert.ok(createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, sig, 'base64url'))
})

test('reader tokens are scoped to the asked repos with read-only contents', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/installation')) return new Response(JSON.stringify({ id: 7 }), { status: 200 })
    return new Response(JSON.stringify({ token: 'ghs_short' }), { status: 201 })
  }
  const tokens = await readerTokens(['ana/one', 'ana/two'], { fetchImpl })
  assert.deepEqual(tokens, { 'ana/one': 'ghs_short', 'ana/two': 'ghs_short' })
  assert.equal(calls[1].url, 'https://api.github.com/app/installations/7/access_tokens')
  assert.deepEqual(JSON.parse(calls[1].options.body), { repositories: ['one', 'two'], permissions: { contents: 'read' } })
})

test('a repo without the app installed is reported as not installed', async () => {
  const fetchImpl = async () => new Response('{}', { status: 404 })
  await assert.rejects(readerTokens(['ana/one'], { fetchImpl }), AppNotInstalled)
})
