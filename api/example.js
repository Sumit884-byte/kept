export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://local')
  const format = url.searchParams.get('format')

  if (format === 'redirect') {
    res.writeHead(302, { Location: '/r/keptsample', 'Cache-Control': 'no-store' })
    res.end()
    return
  }
  if (format === 'page') {
    const { exampleResume } = await import('../src/example.js')
    const { renderPublicPage } = await import('../src/publicPage.js')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.status(200).end(renderPublicPage({ slug: 'keptsample', resume: exampleResume() }))
    return
  }
  if (format === 'pdf') {
    const { exampleResume } = await import('../src/example.js')
    const { fileName, renderPdf } = await import('../src/pdf.js')
    const resume = exampleResume()
    const pdf = await renderPdf(resume)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fileName(resume.name)}"`)
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
    res.end(pdf)
    return
  }

  if (req.method !== 'GET') {
    res.status(405).end()
    return
  }
  const { readExample } = await import('../src/fastRoutes.js')
  res.setHeader('Cache-Control', 'no-store')
  res.json(readExample())
}
