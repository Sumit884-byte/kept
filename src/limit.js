const buckets = new Map()

export function bucketCount() {
  return buckets.size
}

const SWEEP_AT = 10_000

function sweep(now, windowMs) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.start > windowMs) buckets.delete(key)
  }
}

export function allow(key, max, windowMs) {
  const now = Date.now()
  if (buckets.size >= SWEEP_AT) sweep(now, windowMs)
  const bucket = buckets.get(key)
  if (!bucket || now - bucket.start > windowMs) {
    buckets.set(key, { start: now, n: 1 })
    return true
  }
  bucket.n += 1
  return bucket.n <= max
}
