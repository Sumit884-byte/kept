export const GEMMA_MODEL = 'onnx-community/gemma-3-270m-it-ONNX'

export function gemmaMessages({ name, description, files }, budget) {
  const perFile = budget || 1800
  const total = budget ? Math.min(7000, budget * 4) : 7000
  const excerpts = (files || [])
    .slice(0, 6)
    .map((file) => `${file.path}\n${String(file.text || '').slice(0, perFile)}`)
    .join('\n\n')
    .slice(0, total)
  return [
    {
      role: 'system',
      content: [
        'Write one resume sentence that starts with the project name.',
        'Mention only actions or tools that appear in the files.',
        'Do not invent numbers, users, or a category that is not written down.',
        'Do not quote code or ask questions.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Project: ${name || 'Project'}\nDescription: ${description || 'none'}\n\n${excerpts}`,
    },
  ]
}

const ASSISTANT = /\b(i'm ready|i am ready|please provide|as accurately as possible|i'll try|let me know|as an ai|here is|here's)\b/i

export function evidenceWords(files) {
  const words = new Set()
  for (const file of files || []) {
    const text = String(file.text || '')
    if (file.path?.endsWith('package.json')) {
      try {
        const json = JSON.parse(text)
        for (const name of Object.keys({ ...json.dependencies, ...json.devDependencies })) {
          const bare = name.split('/').at(-1).toLowerCase()
          if (bare.length > 2) words.add(bare)
        }
      } catch {
        // A manifest that is not JSON adds no evidence.
      }
    }
    for (const match of text.matchAll(/(?:app|router|route)\.(?:get|post|put|patch|delete)\(\s*['"`]\/?([^'"`]+)/gi)) {
      const last = match[1].split('/').filter(Boolean).at(-1) || ''
      const word = last.replace(/[^a-z0-9-]/gi, '').toLowerCase()
      if (word.length > 2) words.add(word)
    }
  }
  return [...words]
}

export function cleanConclusion(text, name = '', files = []) {
  const clean = String(text || '')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean || clean.length < 12) return ''
  if (/[^\t\n\r\x20-\x7E\u00A0-\u00FF]/.test(clean.split(String(name || '')).join(''))) return ''
  if (/app\.listen|\bfunction\s*\(|\brequire\s*\(|=>|```|\?/.test(clean)) return ''
  if (ASSISTANT.test(clean) || /^(okay|sure|hi|hello)\b/i.test(clean)) return ''
  const cut = clean.length > 500 ? clean.slice(0, 500).replace(/\s+\S*$/, '').trim() : clean
  if (cut.length < 12) return ''
  if (name && !cut.toLowerCase().includes(String(name).toLowerCase())) return ''
  const anchors = evidenceWords(files)
  if (anchors.length && !anchors.some((word) => cut.toLowerCase().includes(word))) return ''
  return /[.!?]$/.test(cut) ? cut : `${cut}.`
}

export function generatedText(output) {
  const first = output?.[0]?.generated_text
  if (typeof first === 'string') return first
  if (!Array.isArray(first)) return ''
  const last = first.at(-1)
  if (typeof last === 'string') return last
  return typeof last?.content === 'string' ? last.content : ''
}
