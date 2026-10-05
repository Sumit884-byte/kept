import { copy } from '../src/copy.js'
import * as db from '../src/db.js'
import { createGuestSession, endKeptSession } from '../src/fastRoutes.js'
import { allow } from '../src/limit.js'

function clientIp(req) {
  const header = (name) => String(req.headers?.[name] || '').split(',')[0].trim()
  return header('x-real-ip') || header('x-vercel-forwarded-for') || header('x-forwarded-for') || 'unknown'
}

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
  if (!allow(`guest:${clientIp(req)}`, 10, 60_000)) {
    res.status(429).json({ message: copy.errors.slowDown })
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
