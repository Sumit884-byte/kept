export function soften(n) {
  const value = Math.abs(Math.round(Number(n) || 0))
  let rounded = value
  if (value >= 1000) rounded = Math.round(value / 100) * 100
  else if (value >= 100) rounded = Math.round(value / 10) * 10
  const text = rounded.toLocaleString('en-US')
  return rounded === value ? text : `about ${text}`
}

function lineClause(additions, deletions) {
  const added = Number(additions) || 0
  const removed = Number(deletions) || 0
  if (added && removed) return `, with ${soften(added)} lines added and ${soften(removed)} removed`
  if (added) return `, with ${soften(added)} lines added`
  if (removed) return `, with ${soften(removed)} lines removed`
  return ''
}

export function enhancementSentence(numbers = {}) {
  const commits = Number(numbers.commits) || 0
  const releases = Number(numbers.releases) || 0
  const parts = []
  if (commits) {
    const lead = numbers.complete
      ? `Over the last three months there were ${commits} updates`
      : `The latest ${commits} updates`
    parts.push(`${lead}${lineClause(numbers.additions, numbers.deletions)}.`)
  } else if (numbers.additions || numbers.deletions) {
    const clause = lineClause(numbers.additions, numbers.deletions).replace(/^, /, '')
    if (clause) parts.push(`${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`)
  }
  if (releases) {
    const name = numbers.latestRelease ? `, most recently ${numbers.latestRelease}` : ''
    const word = releases === 1 ? 'release' : 'releases'
    parts.push(`${releases} ${word} shipped in that time${name}.`)
  }
  return parts.join(' ')
}

export function attentionSentence(numbers = {}) {
  if (numbers.starDelta > 0 && numbers.earlierStars != null) {
    return `People starring it grew from ${numbers.earlierStars} to ${numbers.stars}.`
  }
  if (numbers.issueDelta <= -3 && numbers.earlierIssues != null) {
    return `Open issues fell from ${numbers.earlierIssues} to ${numbers.openIssues}.`
  }
  if (numbers.forkDelta > 0 && numbers.earlierForks != null) {
    return `Forks grew from ${numbers.earlierForks} to ${numbers.forks}.`
  }
  return ''
}

export function joinList(items) {
  const list = items.filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}
