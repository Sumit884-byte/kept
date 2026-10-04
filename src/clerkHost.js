export function clerkFrontendHost(publishableKey) {
  const encoded = String(publishableKey || '').replace(/^pk_(test|live)_/, '')
  if (!encoded) return ''
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const host = Buffer.from(padded, 'base64').toString('utf8').replace(/\$$/, '').trim()
    if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')) return ''
    return host
  } catch {
    return ''
  }
}
