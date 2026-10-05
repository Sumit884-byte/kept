export function accountKind(account) {
  const id = String(account?.github_id || '')
  return {
    sample: id.startsWith('preview:'),
    connected: Boolean(id) && !id.startsWith('preview:') && !id.startsWith('clerk:'),
  }
}

export function githubConnectPlan(mine, other) {
  if (!other || String(other.id) === String(mine?.id)) return 'attach'
  const id = String(mine?.github_id || '')
  if (id.startsWith('clerk:') || id.startsWith('preview:')) return 'adopt'
  return 'taken'
}

export function bindingFromAccount(account) {
  if (!account?.login) return null
  return {
    login: String(account.login),
    preview: Boolean(account.preview),
    githubConnected: Boolean(account.githubConnected),
  }
}

export function sameBinding(left, right) {
  if (!left || !right) return false
  return left.login === right.login
    && Boolean(left.preview) === Boolean(right.preview)
    && Boolean(left.githubConnected) === Boolean(right.githubConnected)
}
