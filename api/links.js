import { copy } from '../src/copy.js'
import { readLinks } from '../src/fastRoutes.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: copy.errors.generic })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  try {
    res.json(await readLinks(req))
  } catch (error) {
    const status = error.status || 500
    res.status(status).json({ message: status === 401 ? copy.errors.signedOut : copy.errors.generic })
  }
}
