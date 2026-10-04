export function applyHistory(project, earlier) {
  if (!project || !earlier) return project
  const numbers = { ...project.numbers }
  if (earlier.stars != null && numbers.stars != null) {
    numbers.earlierStars = earlier.stars
    numbers.starDelta = numbers.stars - earlier.stars
  }
  if (earlier.forks != null && numbers.forks != null) {
    numbers.earlierForks = earlier.forks
    numbers.forkDelta = numbers.forks - earlier.forks
  }
  if (earlier.openIssues != null && numbers.openIssues != null) {
    numbers.earlierIssues = earlier.openIssues
    numbers.issueDelta = numbers.openIssues - earlier.openIssues
  }
  return { ...project, numbers }
}
