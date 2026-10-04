import { copy } from '/copy.js'

let loading = null

function clerkHost(publishableKey) {
  const encoded = String(publishableKey || '').replace(/^pk_(test|live)_/, '')
  if (!encoded) return ''
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const host = atob(padded).replace(/\$$/, '').trim()
    if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')) return ''
    return host
  } catch {
    return ''
  }
}

export function loadClerk(publishableKey) {
  if (window.Clerk?.loaded) return Promise.resolve(window.Clerk)
  if (loading) return loading
  const host = clerkHost(publishableKey)
  if (!host) return Promise.reject(new Error('missing'))
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.clerkPublishableKey = publishableKey
    script.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`
    script.onload = async () => {
      try {
        await window.Clerk.load({
          signInUrl: '/sign-in',
          signUpUrl: '/join',
          appearance: { captcha: { theme: 'light', size: 'flexible' } },
        })
        resolve(window.Clerk)
      } catch (error) {
        loading = null
        reject(error)
      }
    }
    script.onerror = () => {
      loading = null
      reject(new Error('load'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export function clerkMessage(error) {
  const code = error?.errors?.[0]?.code || ''
  if (code === 'form_identifier_not_found' || code === 'form_password_incorrect') return copy.auth.mismatch
  if (code === 'form_identifier_exists') return copy.auth.exists
  if (
    code === 'form_password_pwned'
    || code === 'form_password_length_too_short'
    || code === 'form_password_not_strong_enough'
    || code === 'form_password_size_in_bytes_exceeded'
  ) return copy.auth.weakPassword
  if (code === 'form_code_incorrect' || code === 'verification_failed') return copy.auth.badCode
  if (code === 'too_many_requests') return copy.errors.slowDown
  return copy.errors.generic
}

export async function logIn(publishableKey, email, password) {
  const clerk = await loadClerk(publishableKey)
  const attempt = await clerk.client.signIn.create({ identifier: email, password })
  if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('incomplete')
  await clerk.setActive({ session: attempt.createdSessionId })
}

export async function beginSignIn(publishableKey, email, password) {
  const clerk = await loadClerk(publishableKey)
  const created = await clerk.client.signUp.create({ emailAddress: email, password })
  if (created.status === 'complete' && created.createdSessionId) {
    await clerk.setActive({ session: created.createdSessionId })
    return 'done'
  }
  await clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
  return 'code'
}

export async function confirmSignIn(publishableKey, code) {
  const clerk = await loadClerk(publishableKey)
  const attempt = await clerk.client.signUp.attemptEmailAddressVerification({ code })
  if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('incomplete')
  await clerk.setActive({ session: attempt.createdSessionId })
}
