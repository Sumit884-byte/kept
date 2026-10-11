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

// "Lead with React, Go and the billing work." gives ['React', 'Go', 'billing']. A full stop inside a
// name, as in Node.js, does not end the sentence. The words only count where they open a line, a
// sentence or a clause, so "Do not lead with PHP" and "an engineering lead with ten years" are left alone.
export function leadPhrases(instructions = '') {
  const found = []
  const opening = /(?:^|[.!?;:,\n]|\b(?:and|then|also|should)\b)[ \t]*(?:[-*•–][ \t]*)?(?:(?:please|always),?[ \t]+)*lead with ((?:[^.!\n]|\.(?=\S))+)/gi
  for (const match of String(instructions).matchAll(opening)) {
    for (const part of match[1].split(/,|\band\b/i)) {
      const phrase = part
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^the\s+/i, '')
        .replace(/\s+(?:work|projects?)$/i, '')
        .trim()
      if (phrase) found.push(phrase)
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
