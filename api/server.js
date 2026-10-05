import { buildApp } from '../src/server.js'
import { assertConfig } from '../src/config.js'
import { copy } from '../src/copy.js'
import * as db from '../src/db.js'
import { exampleResume } from '../src/example.js'
import { fileName, renderPdf } from '../src/pdf.js'
import { renderPublicPage } from '../src/publicPage.js'

const EXAMPLE_SLUG = 'keptsample'

let app = null
let ready = null

function expressApp() {
  if (!app) app = buildApp()
  return app
}

export const config = {
  maxDuration: 60,
}

function keptPath(req) {
  const current = new URL(req.url || '/', 'http://local')
  const kept = current.searchParams.get('kept') || ''
  if (!kept.startsWith('/') || kept.startsWith('//')) return ''
  return kept
}

function pathnameOf(kept) {
  return new URL(kept, 'http://local').pathname
}

async function sendExamplePdf(res) {
  const resume = exampleResume()
  const pdf = await renderPdf(resume)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${fileName(resume.name)}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.end(pdf)
}

function sendExamplePage(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.end(renderPublicPage({ slug: EXAMPLE_SLUG, resume: exampleResume() }))
}

export default function handler(req, res) {
  const kept = keptPath(req)
  if (!kept) {
    res.status(404).json({ message: copy.errors.missingLink })
    return
  }
  const pathname = pathnameOf(kept)
  const examplePdf = req.method === 'GET' && (pathname === '/example.pdf' || pathname === `/r/${EXAMPLE_SLUG}.pdf`)
  const examplePage = req.method === 'GET' && (pathname === '/sample' || pathname === `/r/${EXAMPLE_SLUG}`)
  if (examplePdf || examplePage) {
    const sent = examplePdf ? sendExamplePdf(res) : Promise.resolve(sendExamplePage(res))
    sent.catch((error) => {
      console.error(error)
      if (!res.headersSent) res.status(500).json({ message: copy.errors.generic })
    })
    return
  }
  try {
    assertConfig()
  } catch (error) {
    console.error(error.message)
    res.status(503).json({ message: copy.errors.generic })
    return
  }
  req.url = kept
  req.originalUrl = kept
  const skipStore = req.method === 'POST' && pathname === '/api/auth/logout'
  if (!skipStore && !ready) ready = db.migrate()
  const pending = skipStore ? Promise.resolve() : ready
  pending.then(() => {
    expressApp()(req, res)
  }).catch((error) => {
    console.error(error)
    if (res.headersSent) return
    if (req.method === 'GET' && pathname.startsWith('/r/')) {
      res.status(404).type('html').send(renderPublicPage(null))
      return
    }
    res.status(500).json({ message: copy.errors.generic })
  })
}
