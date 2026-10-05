import { copy } from '../src/copy.js'
import * as db from '../src/db.js'
import { createGuestSession, endKeptSession } from '../src/fastRoutes.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: copy.errors.generic })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  const url = new URL(req.url || '/', 'http://local')
  if (url.searchParams.get('action') === 'leave') {
    try {
      await endKeptSession(req, res)
      res.json({ ok: true })
    } catch (error) {
      console.error('guest leave failed', error)
      res.status(500).json({ message: copy.errors.generic })
    }
    return
  }
  try {
    await db.migrate()
    const payload = await createGuestSession(res)
    res.status(201).json(payload)
  } catch (error) {
    console.error('guest session failed', error)
    res.status(500).json({ message: copy.errors.generic })
  }
}
