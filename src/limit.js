const buckets = new Map()

export function allow(key, max, windowMs) {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now - bucket.start > windowMs) {
    buckets.set(key, { start: now, n: 1 })
    return true
  }
  bucket.n += 1
  return bucket.n <= max
}
