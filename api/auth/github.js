import { config } from '../../src/config.js'
import { githubStart } from '../../src/githubAuth.js'

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end()
    return
  }
  if (!config.githubClientId || !config.githubClientSecret) {
    res.redirect('/start?notice=setup')
    return
  }
  const started = githubStart()
  res.setHeader('Set-Cookie', started.cookie)
  res.setHeader('Cache-Control', 'no-store')
  res.redirect(started.location)
}
