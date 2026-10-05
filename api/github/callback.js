import { githubFinish } from '../../src/githubAuth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end()
    return
  }
  const done = await githubFinish(req)
  res.setHeader('Set-Cookie', done.cookie)
  res.setHeader('Cache-Control', 'no-store')
  res.redirect(done.location)
}
