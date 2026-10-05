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

export function keptAppearance() {
  return {
    layout: {
      logoImageUrl: '/favicon.svg',
      logoLinkUrl: '/',
      logoPlacement: 'inside',
      socialButtonsPlacement: 'bottom',
      socialButtonsVariant: 'blockButton',
      shimmer: false,
    },
    variables: {
      colorPrimary: '#1f6a4a',
      colorDanger: '#9c4328',
      colorSuccess: '#1f6a4a',
      colorBackground: '#fffdf8',
      colorInputBackground: '#ffffff',
      colorText: '#211c16',
      colorTextSecondary: '#645c52',
      fontFamily: '"Public Sans", "Avenir Next", "Segoe UI", sans-serif',
      fontFamilyButtons: '"Public Sans", "Avenir Next", "Segoe UI", sans-serif',
      borderRadius: '0.9rem',
    },
    elements: {
      headerTitle: { fontFamily: 'Fraunces, Georgia, serif', fontWeight: '560' },
      headerSubtitle: { color: '#645c52' },
      formButtonPrimary: { backgroundColor: '#1f6a4a', textTransform: 'none' },
      socialButtonsRoot: { display: 'none' },
      dividerRow: { display: 'none' },
      socialButtonsBlockButton: { display: 'none' },
      card: {
        boxShadow: '0 24px 60px rgba(72, 48, 20, 0.12)',
        border: '1px solid rgba(48, 36, 22, 0.14)',
      },
    },
    captcha: { theme: 'light', size: 'flexible' },
  }
}

export function keptWords() {
  return {
    signIn: {
      start: {
        title: 'Log in',
        subtitle: 'Use the email and password you made for Kept.',
      },
    },
    signUp: {
      start: {
        title: 'Sign in',
        subtitle: 'Use your email and a strong password. We will email you a code.',
      },
    },
  }
}

function clerkProxy(publishableKey) {
  if (!String(publishableKey || '').startsWith('pk_live_')) return ''
  return `${location.origin}/__clerk`
}

export function loadClerk(publishableKey) {
  if (window.Clerk?.loaded) return Promise.resolve(window.Clerk)
  if (loading) return loading
  const proxy = clerkProxy(publishableKey)
  const host = clerkHost(publishableKey)
  if (!proxy && !host) return Promise.reject(new Error('missing'))
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.clerkPublishableKey = publishableKey
    if (proxy) script.dataset.clerkProxyUrl = proxy
    script.src = proxy
      ? `${proxy}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`
      : `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`
    script.onload = async () => {
      try {
        await window.Clerk.load({
          signInUrl: '/sign-in',
          signUpUrl: '/join',
          appearance: keptAppearance(),
          localization: keptWords(),
          ...(proxy ? { proxyUrl: proxy } : {}),
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
  if (/oauth|strategy_not_allowed|provider/.test(code)) return copy.auth.googleFailed
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

export async function showClerkAuth(node, publishableKey, { mode, next }) {
  if (node.dataset.mode === mode && node.childElementCount) return
  const clerk = await loadClerk(publishableKey)
  const appearance = keptAppearance()
  const after = next || '/'
  node.dataset.mode = mode
  clerk.unmountSignIn?.(node)
  clerk.unmountSignUp?.(node)
  if (mode === 'join') {
    clerk.mountSignUp(node, {
      appearance,
      signInUrl: '/sign-in',
      fallbackRedirectUrl: after,
      forceRedirectUrl: after,
    })
    return
  }
  clerk.mountSignIn(node, {
    appearance,
    signUpUrl: '/join',
    fallbackRedirectUrl: after,
    forceRedirectUrl: after,
  })
}

export async function continueWithGoogle(publishableKey, next) {
  const clerk = await loadClerk(publishableKey)
  await clerk.client.signIn.authenticateWithRedirect({
    strategy: 'oauth_google',
    redirectUrl: '/sso-callback',
    redirectUrlComplete: next || '/',
  })
}

export async function finishGoogleRedirect(publishableKey) {
  const clerk = await loadClerk(publishableKey)
  await clerk.handleRedirectCallback()
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

export async function sendPasswordReset(publishableKey, email) {
  const clerk = await loadClerk(publishableKey)
  await clerk.client.signIn.create({
    strategy: 'reset_password_email_code',
    identifier: email,
  })
}

export async function finishPasswordReset(publishableKey, code, password) {
  const clerk = await loadClerk(publishableKey)
  let attempt = await clerk.client.signIn.attemptFirstFactor({
    strategy: 'reset_password_email_code',
    code,
    password,
  })
  if (attempt.status === 'needs_new_password') {
    attempt = await clerk.client.signIn.resetPassword({
      password,
      signOutOfOtherSessions: true,
    })
  }
  if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('incomplete')
  await clerk.setActive({ session: attempt.createdSessionId })
}

export async function confirmSignIn(publishableKey, code) {
  const clerk = await loadClerk(publishableKey)
  const attempt = await clerk.client.signUp.attemptEmailAddressVerification({ code })
  if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('incomplete')
  await clerk.setActive({ session: attempt.createdSessionId })
}
