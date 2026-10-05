export { displayProjectTitle } from './display.js'
export { pdfText, fileName } from './pdfText.js'
import crypto from 'node:crypto'
import { renderPdf as renderFresh } from './resumePdf.js'

const CACHE_MAX = 64
const cache = new Map()

export async function renderPdf(resume) {
  const key = crypto.createHash('sha256').update(JSON.stringify(resume ?? null)).digest('base64url')
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const pending = renderFresh(resume)
  cache.set(key, pending)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  try {
    return await pending
  } catch (error) {
    cache.delete(key)
    throw error
  }
}
