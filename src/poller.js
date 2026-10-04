import { config } from './config.js'
import { copy } from './copy.js'
import * as db from './db.js'
import { refreshLink } from './jobs.js'

let timer

async function tick() {
  try {
    const ids = await db.linksDue(Math.floor(config.pollMs / 1000))
    for (const id of ids) {
      await refreshLink(id, { mode: 'check', reason: copy.reasons.updated })
    }
  } catch (error) {
    console.error('poll failed', error.message)
  }
}

export function startPoller() {
  timer = setInterval(tick, Math.max(config.pollMs, 15000))
  if (timer.unref) timer.unref()
}

export function stopPoller() {
  if (timer) clearInterval(timer)
  timer = undefined
}
