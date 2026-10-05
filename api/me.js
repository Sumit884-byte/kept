import { copy } from '../src/copy.js'
import { readMe } from '../src/fastRoutes.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: copy.errors.generic })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json(await readMe(req))
}
