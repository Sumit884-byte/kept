import { NAMED } from './skillNames.js'

// A posting is prose, and some tools are named after everyday words. Such a word is read as the
// tool when it is written as a name: capitalised inside a line ("comfortable with Express"), or
// opening a line or a sentence as the start of a list or of a statement about it ("Go, Rust and
// Python", "Go is our main language"). A capital that is only there because the word opens a
// sentence ("Express yourself") does not count. A list of patterns means any of them.
const BULLET = String.raw`(?:[-*•●·▪◦–—]|\d+[.)])`

function named(word, followers = '', statement = true) {
  const then = `${statement ? '|(?:is|are)\\b' : ''}${followers ? `|(?:${followers})\\b` : ''}`
  return [
    new RegExp(String.raw`(?:[A-Za-z0-9,;:)&+][ \t\u00a0]+|[(/&+,])${word}\b(?![ \t]*:)`),
    new RegExp(
      String.raw`(?:^[ \t\u00a0]*(?:${BULLET}[ \t\u00a0]*)?|[.!?][ \t]+)${word}\b(?=[ \t]*(?:[,/);.&+]|$|(?:and|or)[ \t]+[A-Z]${then}))`,
      'm',
    ),
  ]
}

// The lowercase word counts where it is plainly an item of a list. A word that is also a verb
// does not count after "and": "and react well" is not the library.
function listed(word, afterAnd = true) {
  return [
    new RegExp(String.raw`\b${word}\b(?=[ \t]*[,/);])`),
    new RegExp(String.raw`(?:[,/&+][ \t]*${afterAnd ? String.raw`|\b(?:and|or)[ \t]+` : ''})${word}\b`),
    new RegExp(String.raw`^[ \t\u00a0]*(?:${BULLET}[ \t\u00a0]*)?${word}[ \t]*$`, 'm'),
  ]
}

const PEOPLE = 'developers?|engineers?|experience'

const ASKED = {
  'Node.js': [/\bnode\.?js\b/i, ...named('Node', `${PEOPLE}|services?|backend|apps?`)],
  Express: [/\bexpress\.?js\b/i, ...named('Express', 'framework|server|middleware|apps?')],
  React: [
    /\bREACT\b/,
    /\breact\.?js\b/i,
    ...named('React', `${PEOPLE}|native|hooks?|components?|apps?`),
    /\b(?:using|with|in|know|knows|write|writing) react\b/,
    /\breact(?:[ -]native| hooks?| components?| developers?| engineers?| experience| apps?)\b/,
    ...listed('react', false),
  ],
  Flask: [...named('Flask', `${PEOPLE}|apps?`), ...listed('flask')],
  Swift: [/\bSwiftUI\b/, ...named('Swift', `${PEOPLE}|code`)],
  Ruby: [/\bruby on rails\b/i, ...named('Ruby', `${PEOPLE}|on rails`)],
  Rust: named('Rust', `${PEOPLE}|code`),
}

// A resume shows a tool by any spelling a posting can ask for it in.
const SHOWN_TOO = {
  'Node.js': [/\bNode\b/],
  Express: [/\bexpress\.?js\b/i],
  React: [/\breact\.?js\b/i],
  Swift: [/\bSwiftUI\b/],
}

const RAILS = [/\bruby on rails\b/i, ...named('Rails', `${PEOPLE}|apps?`)]
const REST = [/\bREST\b/, /\brestful\b/i, /\brest[ -](?:apis?|services?|endpoints?)\b/i]
const SPRING = [/\bspring ?boot\b/i, /\bspring (?:framework|mvc|security|data|cloud)\b/i]
const DOTNET = /(?:^|[^a-z0-9])\.net\b|\bdotnet\b|\basp\.net\b/i

// Words that are written like a tool and are not one: a card company, a season, a place. They are
// blanked out at the same length, so the order things are asked in stays the same. "Spring Boot"
// and its relatives are never taken for the season.
const SPRING_TOOL = String.raw`(?![ \t]*(?:boot|framework|mvc|security|data|cloud)\b)`
const SEASON = String.raw`(?:spring\b${SPRING_TOOL}|summer\b|fall\b|autumn\b|winter\b)`
const NOT_TOOLS = [
  /\b(?:American|Federal|FedEx|Pony|Orient) Express\b/g,
  /\bSilver Spring\b|\bSpring (?:Street|St\.|Valley|Hill|Lake|Creek|Garden)\b/g,
  new RegExp(String.raw`\b(${SEASON})(?:[ \t]*(?:[,/&-]|and\b|or\b)[ \t]*(?!\1\b)${SEASON})+`, 'gi'),
  new RegExp(String.raw`\b(?:start(?:ing|s)?(?: date)?|terms?|semesters?|seasons?|cohorts?|sessions?|intake)\b[ \t]*:?[ \t]*(?:in[ \t]+|is[ \t]+)?spring\b${SPRING_TOOL}`, 'gi'),
  /\bspring\b(?=[ \t]*[-/,]?[ \t]*(?:['’]?\d|semester\b|term\b|quarter\b|break\b|intern|cohort\b|start\b|intake\b|admission|graduat|class\b))/gi,
]
// "in Spring" is the season unless the text is about the Java world, where it is the framework.
const SPRING_AFTER_A_WHEN = new RegExp(String.raw`\b(?:in|for|from|by|this|next|last|every|each|during|since|until|of)[ \t]+spring\b${SPRING_TOOL}`, 'gi')
const JAVA_WORLD = /\b(?:java(?!script)|kotlin|jvm|hibernate|maven|gradle)\b/i

function blank(found) {
  return ' '.repeat(found.length)
}

function withoutLookalikes(text) {
  const out = NOT_TOOLS.reduce((kept, pattern) => kept.replace(pattern, blank), String(text || ''))
  return JAVA_WORLD.test(out) ? out : out.replace(SPRING_AFTER_A_WHEN, blank)
}

// [name, how a posting asks for it, what counts as showing it (the same when left out)]
const MORE = [
  ['Go',
    [/\bgolang\b/i, ...named('Go', `${PEOPLE}|services?|programming|microservices|backend|code`)],
    [/\bgolang\b/i, /\bGo\b/]],
  ['C++', /\bc\+\+/i],
  ['C#', /\bc#/i],
  ['.NET', DOTNET],
  ['Scala', /\bScala\b/],
  ['Shell', /\bbash\b|\bshell script/i, /\bbash\b|\bshell\b/i],
  ['SQL', /\bsql\b/i, [/(?:^|[^a-z])(?:my|postgre|ms|t-?|pl\/?(?:pg)?|pg|p|spark|k)?sql(?:ite|alchemy)?\b/im, /\bpostgres/i]],
  ['MySQL', /\bmysql\b/i],
  ['MongoDB', /\bmongo(?:db)?\b/i],
  ['SQLite', /\bsqlite\b/i],
  ['Elasticsearch', /\belastic\s?search\b/i],
  ['Kafka', /\bkafka\b/i],
  ['RabbitMQ', /\brabbitmq\b/i],
  ['AWS', /\baws\b|\bamazon web services\b/i],
  ['Google Cloud', /\bgcp\b|\bgoogle cloud\b/i],
  ['Azure', /\bazure\b/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['Terraform', /\bterraform\b/i],
  ['CI/CD',
    /\bci\s?\/\s?cd\b|\bcontinuous (?:integration|delivery|deployment)\b/i,
    /\bci\s?\/\s?cd\b|\bcontinuous (?:integration|delivery|deployment)\b|\bgithub actions\b|\bjenkins\b|\bcircleci\b/i],
  ['Linux', /\blinux\b/i],
  ['Git', /\bgit\b/i, /\bgit(?:hub|lab)?\b/i],
  ['REST', REST],
  ['gRPC', /\bgrpc\b/i],
  ['WebSockets', /\bweb\s?sockets?\b/i],
  ['Machine learning',
    [/\bmachine learning\b/i, /\bML\b/],
    [/\bmachine learning\b|\bpytorch\b|\btensorflow\b|\bscikit/i, /\bML\b/]],
  ['Language models',
    /\bllms?\b|\blarge language models?\b|\bgenerative ai\b/i,
    /\bllms?\b|\blanguage models?\b|\bgenerative ai\b|\bgemma\b|\bgpt\b/i],
  ['PyTorch', /\bpytorch\b/i],
  ['TensorFlow', /\btensorflow\b/i],
  ['pandas', /\bpandas\b/i],
  ['NumPy', /\bnumpy\b/i],
  ['Flutter', /\bflutter\b/i],
  ['Rails', RAILS],
  ['Spring', [...SPRING, ...named('Spring', `${PEOPLE}|microservices|applications?|apps?|services?`, false)], [...SPRING, /\bSpring\b/]],
  ['Laravel', /\blaravel\b/i],
  ['Jest', /\bjest\b/i],
  ['Cypress', /\bcypress\b/i],
  ['Playwright', /\bplaywright\b/i],
  ['Storybook', /\bstorybook\b/i],
  ['Vite', /\bvite\b/i],
  ['Webpack', /\bwebpack\b/i],
  ['Firebase', /\bfirebase\b/i],
  ['Supabase', /\bsupabase\b/i],
  ['Stripe', /\bstripe\b/i],
  ['Accessibility', /\baccessibility\b|\ba11y\b|\bwcag\b/i, /\baccessibility\b|\ba11y\b|\bwcag\b|\bscreen readers?\b/i],
  ['Design systems', /\bdesign systems?\b/i],
]

function any(patterns) {
  return Array.isArray(patterns) ? patterns : [patterns]
}

const TERMS = [
  ...NAMED.map(([name, pattern]) => ({ name, asked: any(ASKED[name] || pattern), shown: [pattern, ...(SHOWN_TOO[name] || [])] })),
  ...MORE.map(([name, asked, shown]) => ({ name, asked: any(asked), shown: any(shown || asked) })),
]

const MAX_POSTING = 20_000
const MAX_TERMS = 24

function firstAt(patterns, text) {
  let at = -1
  for (const pattern of patterns) {
    const found = text.search(pattern)
    if (found >= 0 && (at < 0 || found < at)) at = found
  }
  return at
}

export function postingTerms(posting) {
  const text = withoutLookalikes(String(posting || '').slice(0, MAX_POSTING))
  return TERMS
    .map((term, order) => ({ name: term.name, shown: term.shown, at: firstAt(term.asked, text), order }))
    .filter((term) => term.at >= 0)
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .slice(0, MAX_TERMS)
}

// `evidence` is everything this version of the resume can point to: its own lines and the chosen projects.
export function matchPosting(posting, evidence) {
  const blob = withoutLookalikes(evidence)
  const covered = []
  const missing = []
  for (const term of postingTerms(posting)) {
    if (term.shown.some((pattern) => pattern.test(blob))) covered.push(term.name)
    else missing.push(term.name)
  }
  return { covered, missing }
}

function escapeForPattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Whether a piece of text shows one thing: a tool from the list by its patterns, anything else as a whole phrase.
export function shows(name, text) {
  const wanted = String(name || '').trim().toLowerCase()
  if (!wanted) return false
  const blob = withoutLookalikes(text)
  const term = TERMS.find((item) => item.name.toLowerCase() === wanted)
  if (term) return term.shown.some((pattern) => pattern.test(blob))
  return new RegExp(`(?:^|[^a-z0-9])${escapeForPattern(wanted)}(?:$|[^a-z0-9])`, 'i').test(blob)
}

export function resumeEvidence(resume, projects = []) {
  const parts = []
  const work = resume ? [...(resume.work || []), ...(resume.contributions || [])] : []
  if (resume) {
    parts.push(resume.headline, resume.summary, ...(resume.skills || []), ...(resume.experience || []), ...(resume.education || []))
    for (const item of work) parts.push(item.title, item.line, ...(item.lines || []))
  }
  for (const project of projects || []) {
    parts.push(project.name, project.description, project.conclusion, ...(project.highlights || []))
    parts.push(project.language, ...(project.languages || []), ...(project.skills || []))
  }
  // Every project on a resume here was read from a Git host.
  if (work.length || (projects || []).length) parts.push('Git')
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n')
}

// The sentence a brief can carry. `leadPhrases` in brief.js reads the same names back out of it.
export function leadSentence(names) {
  const list = (names || []).filter(Boolean)
  if (!list.length) return ''
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  return `Lead with ${joined}.`
}
