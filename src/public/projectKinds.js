function aboutText(project) {
  return [project.description, project.conclusion, ...(project.highlights || [])]
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}

export function isProfileReadmeProject(project) {
  const fullName = String(project.fullName || project.full_name || '').trim()
  const [owner, repo] = fullName.split('/')
  if (owner && repo && owner.toLowerCase() === repo.toLowerCase()) return true
  return /github profile readme/i.test(aboutText(project))
}

export function isProfileReadmeRepo(fullName) {
  const [owner, repo] = String(fullName || '').trim().split('/')
  return Boolean(owner && repo && owner.toLowerCase() === repo.toLowerCase())
}
