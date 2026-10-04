const STOP = new Set([
  'this', 'that', 'with', 'from', 'your', 'about', 'never', 'mention', 'leave',
  'first', 'person', 'should', 'would', 'could', 'their', 'there', 'they',
  'them', 'into', 'onto', 'only', 'just', 'have', 'been', 'being', 'were',
  'what', 'when', 'where', 'which', 'while', 'also', 'than', 'then', 'each',
  'version', 'written', 'write', 'role', 'roles', 'work', 'lead', 'keep',
])

export function neverPhrases(instructions = '') {
  const found = []
  const patterns = [/never mention ([^.!\n]+)/gi, /leave out ([^.!\n]+)/gi]
  for (const pattern of patterns) {
    for (const match of instructions.matchAll(pattern)) {
      for (const part of match[1].split(/,|\band\b/i)) {
        const phrase = part.trim().replace(/^["']|["']$/g, '')
        if (phrase) found.push(phrase)
      }
    }
  }
  return found
}

export function wantsFirstPerson(instructions = '') {
  return /\bfirst person\b|\bi am\b|\bi'm\b/i.test(instructions)
}

export function briefTokens(text = '') {
  return [...new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9+.#\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP.has(word)),
  )]
}

export function containsPhrase(text, phrases) {
  const lower = String(text || '').toLowerCase()
  return phrases.some((phrase) => phrase && lower.includes(phrase.toLowerCase()))
}
