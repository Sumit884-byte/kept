export function updatedLabel(input, now = Date.now()) {
  const then = new Date(input).getTime()
  if (!input || Number.isNaN(then)) return ''
  const days = Math.round((now - then) / 86400000)
  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated yesterday'
  if (days < 30) return `Updated ${days} days ago`
  const months = Math.round(days / 30)
  if (months <= 1) return 'Updated last month'
  if (months < 12) return `Updated ${months} months ago`
  const years = Math.round(months / 12)
  return years <= 1 ? 'Updated last year' : `Updated ${years} years ago`
}
