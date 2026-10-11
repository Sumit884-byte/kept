function ago(input, now) {
  const then = new Date(input).getTime()
  if (!input || Number.isNaN(then)) return ''
  const days = Math.round((now - then) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  if (months <= 1) return 'last month'
  if (months < 12) return `${months} months ago`
  const years = Math.round(months / 12)
  return years <= 1 ? 'last year' : `${years} years ago`
}

export function updatedLabel(input, now = Date.now()) {
  const when = ago(input, now)
  return when ? `Updated ${when}` : ''
}

function times(count) {
  return count === 1 ? 'once' : `${count.toLocaleString('en-US')} times`
}

export function opensLabel(opens, now = Date.now()) {
  const total = Number(opens?.total) || 0
  if (!total) return ''
  const week = Math.min(total, Number(opens.week) || 0)
  const recent = week === total ? ', all in the last 7 days' : week ? `, ${week.toLocaleString('en-US')} in the last 7 days` : ''
  const last = ago(opens.last, now)
  return `Opened ${times(total)}${recent}.${last ? ` Last opened ${last}.` : ''}`
}

export function opensShort(opens) {
  const total = Number(opens?.total) || 0
  return total ? `Opened ${times(total)}` : ''
}
