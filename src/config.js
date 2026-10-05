function cleanUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

export function modelBase(raw) {
  const clean = cleanUrl(raw)
  if (!clean) return ''
  if (/^https?:\/\//i.test(clean)) return clean
  return `http://${clean}/v1`
}

function adopt(name, alias) {
  if (!process.env[name] && process.env[alias]) process.env[name] = process.env[alias]
  return process.env[name] || ''
}

adopt('CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
adopt('CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_SECRET_KEY')

export const config = {
  get port() {
    return Number(process.env.PORT || 3000)
  },
  get publicUrl() {
    return cleanUrl(process.env.PUBLIC_URL || `http://localhost:${this.port}`)
  },
  get tigerUrl() {
    return process.env.TIGER_DATABASE_URL || process.env.DATABASE_URL || ''
  },
  get poolMax() {
    return Number(process.env.TIGER_POOL_MAX || 5)
  },
  get appSecret() {
    return process.env.APP_SECRET || 'dev-only-secret-change-me'
  },
  get githubClientId() {
    return process.env.GITHUB_CLIENT_ID || ''
  },
  get githubClientSecret() {
    return process.env.GITHUB_CLIENT_SECRET || ''
  },
  get webhookSecret() {
    return process.env.WEBHOOK_SECRET || this.appSecret
  },
  get llmKey() {
    return process.env.LLM_API_KEY || ''
  },
  get llmBase() {
    return modelBase(process.env.LLM_BASE_URL || '')
  },
  get llmModel() {
    return process.env.LLM_MODEL || 'gemma-3-4b-it'
  },
  get pollMs() {
    return Number(process.env.POLL_INTERVAL_MS || 10 * 60 * 1000)
  },
  get trustProxy() {
    const raw = String(process.env.TRUST_PROXY || '').trim()
    if (!raw) return this.isProd ? 1 : false
    if (/^\d+$/.test(raw)) return Number(raw)
    if (raw === 'true' || raw === 'false') return raw === 'true'
    return raw
  },
  get isProd() {
    return process.env.NODE_ENV === 'production'
  },
  get clerkPublishableKey() {
    return process.env.CLERK_PUBLISHABLE_KEY || ''
  },
  get clerkSecretKey() {
    return process.env.CLERK_SECRET_KEY || ''
  },
}

export function assertConfig() {
  if (!config.tigerUrl) {
    throw new Error('Set TIGER_DATABASE_URL to a Tiger Data service URL before starting.')
  }
  if (config.isProd && config.appSecret === 'dev-only-secret-change-me') {
    throw new Error('Set APP_SECRET before running in production.')
  }
}
