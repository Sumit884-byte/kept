import { copy } from '../../../src/copy.js'
import { clerkUserId, savePerson } from '../../../src/fastRoutes.js'
import * as db from '../../../src/db.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.status(405).json({ message: copy.errors.generic })
    return
  }
  const id = req.query.id
  if (!UUID.test(id || '')) {
    res.status(404).json({ message: copy.errors.missingLink })
    return
  }
  try {
    const userId = await clerkUserId(req)
    const account = userId ? await db.getAccountByClerkId(userId) : null
    if (!account) {
      res.status(401).json({ message: copy.errors.signedOut })
      return
    }
    const saved = await savePerson(account.id, id, req.body || {})
    if (!saved) {
      res.status(404).json({ message: copy.errors.missingLink })
      return
    }
    res.json(saved)
  } catch (error) {
    if (error.code === 'email') {
      res.status(400).json({ message: copy.errors.email })
      return
    }
    console.error(error)
    res.status(500).json({ message: copy.errors.generic })
  }
}
