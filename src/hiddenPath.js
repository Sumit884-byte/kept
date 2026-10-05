export function isHiddenPath(pathname) {
  return /(^|\/)\.(?!well-known(\/|$))/.test(pathname || '')
}
