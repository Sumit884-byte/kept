(function () {
  var u = new URL(location.href)
  if (!u.searchParams.has('__clerk_handshake') && !u.searchParams.has('__clerk_db_jwt')) return
  u.searchParams.delete('__clerk_handshake')
  u.searchParams.delete('__clerk_db_jwt')
  var q = u.searchParams.toString()
  history.replaceState({}, '', u.pathname + (q ? '?' + q : '') + u.hash)
})()
