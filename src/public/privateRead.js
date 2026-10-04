import { concludeWithGemma } from './gemma.js'
import { samplePrivate } from './samplePrivate.js'

function safePath(filePath) {
  return typeof filePath === 'string' && /^[\w./-]+$/.test(filePath) && !filePath.includes('..')
}

function contentsUrl(fullName, filePath) {
  const encoded = filePath.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `https://api.github.com/repos/${fullName}/contents/${encoded}`
}

async function githubFiles(token, read) {
  const files = []
  for (const filePath of (read.filePaths || []).filter(safePath).slice(0, 6)) {
    const response = await fetch(contentsUrl(read.fullName, filePath), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) continue
    const text = (await response.text()).slice(0, 12000)
    if (text) files.push({ path: filePath, text })
  }
  return files
}

export async function readPrivateLocally(reads, { preview, token, conclude = concludeWithGemma } = {}) {
  const readings = []
  for (const read of reads || []) {
    const files = preview
      ? (samplePrivate[read.fullName] || []).filter((file) => safePath(file.path))
      : await githubFiles(token, read)
    if (!files.length) continue
    const conclusion = await conclude({
      name: read.name,
      description: read.description || '',
      files,
    })
    if (conclusion) readings.push({ fullName: read.fullName, conclusion })
  }
  return readings
}
