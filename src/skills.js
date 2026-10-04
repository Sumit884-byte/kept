import { briefTokens } from './brief.js'

const NAMED = [
  ['React Native', /\breact native\b/i],
  ['Next.js', /\bnext\.?js\b/i],
  ['Node.js', /\bnode\.?js\b/i],
  ['TypeScript', /\btypescript\b/i],
  ['JavaScript', /\bjavascript\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['GraphQL', /\bgraphql\b/i],
  ['Tailwind', /\btailwind(?:css)?\b/i],
  ['FastAPI', /\bfastapi\b/i],
  ['Express', /\bexpress(?:\.js)?\b/i],
  ['Fastify', /\bfastify\b/i],
  ['Django', /\bdjango\b/i],
  ['Flask', /\bflask\b/i],
  ['Python', /\bpython\b/i],
  ['React', /\breact\b/i],
  ['Vue', /\bvue(?:\.js)?\b/i],
  ['Svelte', /\bsvelte\b/i],
  ['Angular', /\bangular\b/i],
  ['Kotlin', /\bkotlin\b/i],
  ['Swift', /\bswift\b/i],
  ['Ruby', /\bruby\b/i],
  ['Rust', /\brust\b/i],
  ['Elixir', /\belixir\b/i],
  ['PHP', /\bphp\b/i],
  ['Java', /\bjava\b(?!script)/i],
  ['Redis', /\bredis\b/i],
  ['Docker', /\bdocker\b/i],
  ['Prisma', /\bprisma\b/i],
  ['Figma', /\bfigma\b/i],
  ['CSS', /\bcss\b/i],
  ['HTML', /\bhtml\b/i],
]

const FROM_DEPENDENCY = {
  react: 'React',
  'react-native': 'React Native',
  expo: 'React Native',
  next: 'Next.js',
  vue: 'Vue',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  hono: 'Hono',
  fastapi: 'FastAPI',
  flask: 'Flask',
  django: 'Django',
  typescript: 'TypeScript',
  tailwindcss: 'Tailwind',
  prisma: 'Prisma',
  pg: 'PostgreSQL',
  postgres: 'PostgreSQL',
  redis: 'Redis',
  graphql: 'GraphQL',
  'react-dom': 'React',
}

function addSkill(found, name) {
  const clean = String(name || '').trim()
  if (!clean || clean.length > 32) return
  if (found.some((skill) => skill.toLowerCase() === clean.toLowerCase())) return
  found.push(clean)
}

export function skillsFromEvidence({ language = '', languages = [], text = '', deps = [], skills = [] } = {}) {
  const found = []
  for (const name of [...languages, language, ...skills]) addSkill(found, name)
  const blob = String(text || '')
  for (const [name, pattern] of NAMED) {
    if (pattern.test(blob)) addSkill(found, name)
  }
  for (const dep of deps || []) {
    const raw = String(dep || '').toLowerCase()
    const short = raw.replace(/^@[^/]+\//, '')
    addSkill(found, FROM_DEPENDENCY[raw] || FROM_DEPENDENCY[short] || '')
  }
  return found
}

function projectText(project) {
  return [project.description, project.conclusion, ...(project.highlights || [])].filter(Boolean).join('\n')
}

function roleFit(skill, projects, role, profileText) {
  const needles = briefTokens(role)
  if (!needles.length) return 1
  const key = skill.toLowerCase()
  if (needles.some((needle) => key.includes(needle) || needle.includes(key))) return 3
  const sentences = String(profileText || '').split(/\n+|(?<=[.!?])\s+/)
  const namedInRole = sentences.some((sentence) => {
    const lower = sentence.toLowerCase()
    return lower.includes(key) && needles.some((needle) => lower.includes(needle))
  })
  if (namedInRole) return 3
  const inMatchingProject = (projects || []).some((project) => {
    const hasSkill = skillsFromEvidence({
      language: project.language,
      languages: project.languages,
      skills: project.skills,
      deps: project.deps,
      text: projectText(project),
    }).some((item) => item.toLowerCase() === key)
    if (!hasSkill) return false
    const hay = `${project.name} ${projectText(project)}`.toLowerCase()
    return needles.some((needle) => hay.includes(needle))
  })
  return inMatchingProject ? 2 : 0
}

function remember(counts, label, order, skill, weigh) {
  const key = skill.toLowerCase()
  if (!counts.has(key)) {
    counts.set(key, 0)
    label.set(key, skill)
    order.push(key)
  }
  if (weigh) counts.set(key, counts.get(key) + 1)
}

export function skillsFor(projects, { role = '', profileText = '' } = {}) {
  const counts = new Map()
  const label = new Map()
  const order = []
  for (const project of projects || []) {
    const found = skillsFromEvidence({
      language: project.language,
      languages: project.languages,
      skills: project.skills,
      deps: project.deps,
      text: projectText(project),
    })
    const once = new Set()
    for (const skill of found) {
      const key = skill.toLowerCase()
      if (once.has(key)) continue
      once.add(key)
      remember(counts, label, order, skill, true)
    }
  }
  const needles = briefTokens(role)
  if (needles.length && profileText) {
    for (const skill of skillsFromEvidence({ text: profileText })) {
      if (roleFit(skill, projects, role, profileText) > 0) remember(counts, label, order, skill, false)
    }
  }
  const ranked = order
    .map((key) => ({ key, fit: roleFit(label.get(key), projects, role, profileText) }))
    .filter((item) => !needles.length || item.fit > 0)
  const chosen = (ranked.length ? ranked : order.map((key) => ({ key, fit: 0 })))
    .sort((a, b) => b.fit - a.fit || counts.get(b.key) - counts.get(a.key) || order.indexOf(a.key) - order.indexOf(b.key))
    .map((item) => label.get(item.key))
  return chosen.slice(0, 8)
}
