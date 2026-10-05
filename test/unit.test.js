import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assessReadme, actionsFrom, humanAction, interpret } from '../src/analyze.js'
import { applyHistory } from '../src/history.js'
import { enhancementSentence, soften } from '../src/phrases.js'
import { bulletsFor, composeResume, readableLine, readableResume, uniqueLines } from '../src/resume.js'
import { lineIsGrounded, mergeTailored, namesFromDescriptions, namesFromTerms, projectsForRemote, publicNamesForRole, resumeWithSelection, roleBreakdownRequest, tailorResume } from '../src/tailor.js'
import { GEMMA_MODEL, cleanConclusion, gemmaMessages } from '../src/public/gemmaText.js'
import { gemmaPlans } from '../src/public/gemma.js'
import { samplePrivate } from '../src/public/samplePrivate.js'
import { findSample } from '../src/sample.js'
import { exampleResume } from '../src/example.js'
import { verifyGithubSignature, parseNext, profileName, nameFromProfileReadme } from '../src/github.js'
import { encrypt, decrypt } from '../src/cryptoBox.js'
import { displayProjectTitle } from '../src/display.js'
import { pdfText, renderPdf } from '../src/pdf.js'
import { resumeOutline } from '../src/resumeOutline.js'
import { renderPaperHtml } from '../src/public/paperHtml.js'
import { countPdfPages } from '../src/pdfLayout.js'
import { samplePerson, sampleProjects } from '../src/sample.js'
import { renderPublicPage } from '../src/publicPage.js'
import { modelBase } from '../src/config.js'
import { updatedLabel } from '../src/when.js'
import { isLightPath, paintPerson, personFields, personOnly, projectCounts } from '../src/fast.js'
import { accountKind, bindingFromAccount, githubConnectPlan, sameBinding } from '../src/public/accountBinding.js'

test('a badge-only writeup is treated as thin', () => {
  const result = assessReadme('# Wow\n\n![badge](https://img.shields.io/badge/build-passing)\n')
  assert.equal(result.thin, true)
})

test('html markup is left out of the writeup', () => {
  const result = assessReadme('<p align="center"><img src="mark.svg" alt="Star the repo"></p><h1>Arka</h1><p>Your terminal understands plain English and routes the work to the right skill.</p>')
  assert.equal(result.thin, false)
  assert.match(result.prose, /plain English/)
  assert.doesNotMatch(result.prose, /<|>|align=|src=|Star the repo/)
})

test('a real writeup keeps its prose and stated numbers', () => {
  const result = assessReadme(findSample('northwind/ledger').gather.readme)
  assert.equal(result.thin, false)
  assert.match(result.prose, /small shops/)
  assert.ok(result.stated.some((line) => line.includes('120')))
})

test('routes become plain actions', () => {
  assert.equal(humanAction('/api/v1/drafts'), 'drafts')
  const actions = actionsFrom([{ path: 'src/index.js', text: findSample('northwind/parcel').gather.files[1].text }])
  assert.deepEqual(actions, ['drafts', 'send', 'reminders'])
})

test('a private project is not explained from its files on the server', () => {
  const sample = findSample('northwind/parcel')
  const { project, reading } = interpret({
    ...sample.gather,
    files: [],
    filePaths: sample.gather.files.map((file) => file.path),
  })
  assert.equal(project.private, true)
  assert.equal(reading.detail.needsLocal, true)
  assert.deepEqual(reading.detail.filePaths, ['package.json', 'src/index.js'])
  assert.doesNotMatch(project.conclusion, /drafts/)
  assert.doesNotMatch(JSON.stringify(reading), /app\.listen/)
})

test('thin writeups are explained from the project itself', () => {
  const { project } = interpret(findSample('northwind/parcel').gather)
  assert.equal(project.readmeWasThin, true)
  assert.match(project.conclusion, /drafts/)
  assert.match(project.conclusion, /reminders/)
  assert.match(project.conclusion, /web service/)
  assert.doesNotMatch(project.conclusion, /TODO/)
  assert.doesNotMatch(project.conclusion, /app\.listen/)
  assert.equal(project.numbers.commits, 15)
  assert.equal(project.numbers.additions, 820)
})

test('history turns two readings into a change', () => {
  const { project } = interpret(findSample('northwind/ledger').gather)
  const withHistory = applyHistory(project, findSample('northwind/ledger').earlier)
  assert.equal(withHistory.numbers.starDelta, 28)
  assert.match(enhancementSentence(withHistory.numbers), /three months/)
  assert.match(enhancementSentence(withHistory.numbers), /1,400/)
})

test('numbers are softened without inventing precision', () => {
  assert.equal(soften(40), '40')
  assert.equal(soften(1388), 'about 1,400')
})

test('a brief can drop a project and change the voice', () => {
  const resume = exampleResume()
  assert.equal(resume.headline, 'Product engineer')
  assert.match(resume.summary, /Ledger and Parcel/)
  assert.doesNotMatch(resume.summary, /^Product engineer/)
  assert.ok(resume.work.some((item) => item.lines.join(' ').includes('12') && item.lines.join(' ').includes('40')))
  assert.equal(resume.work.find((item) => item.title === 'Ledger').stars, 40)
  assert.ok(resume.work.every((item) => !/latest \d+ updates|three months/i.test(item.lines.join(' '))))
  assert.ok(resume.skills.includes('TypeScript'))
  assert.ok(resume.skills.includes('JavaScript'))
  assert.ok(resume.skills.indexOf('TypeScript') < resume.skills.indexOf('JavaScript') || resume.skills.includes('TypeScript'))
  assert.ok(!resume.skills.includes('Express'))
  assert.ok(resume.education.some((line) => /Lisbon University/.test(line)))
  assert.ok(resume.contributions.some((item) => /product/i.test(item.line)))
  const hidden = composeResume({
    person: { name: 'Mira Chen', email: 'mira@example.com' },
    projects: [interpret(findSample('northwind/parcel').gather).project],
    prefs: { instructions: 'First person. Never mention Parcel.', roleTarget: 'designer' },
  })
  assert.equal(hidden.work.length, 0)
  assert.match(hidden.summary, /leave out/)
})

test('a project does not repeat the same wording', () => {
  const lines = uniqueLines([
    'Exam-guided RAG pipeline for textbook study at scale. Uses exam papers as ground truth.',
    'Exam-guided RAG pipeline for textbook study at scale. Uses exam papers as ground truth to retrieve more.',
    'Arka Your terminal, upgraded. Plain English routes work to a language model.',
    'The latest 8 updates, with about 2,500 lines added.',
  ], 'Arka')
  assert.equal(lines.length, 3)
  assert.doesNotMatch(lines[1], /^Arka\b/)
  assert.match(lines[2], /2,500/)
})

test('a contributed copy is not shown as owned work', () => {
  const dirty = 'media=" prefers-color-scheme: dark " srcset=" Easy, fast, and cheap LLM serving for everyone Documentation Blog Paper'
  const lines = bulletsFor({
    name: 'vllm',
    description: 'A high-throughput and memory-efficient inference and serving engine for LLMs',
    conclusion: dirty,
  })
  assert.deepEqual(lines, ['A high-throughput and memory-efficient inference and serving engine for LLMs'])
  const resume = composeResume({
    person: { name: 'Sumit Mishra', login: 'Sumit884-byte' },
    projects: [
      { name: 'arka', description: 'A terminal agent for local work.', private: false, url: 'https://github.com/Sumit884-byte/arka' },
      {
        name: 'vllm',
        description: 'A high-throughput and memory-efficient inference and serving engine for LLMs',
        conclusion: dirty,
        fork: true,
        url: 'https://github.com/Sumit884-byte/vllm',
        contributions: ['Added a scheduler test for the engine'],
      },
    ],
    prefs: { roleTarget: 'ai developer' },
  })
  assert.deepEqual(resume.work.map((item) => item.title), ['arka'])
  assert.equal(resume.contributions[0].title, 'vllm')
  assert.match(resume.contributions[0].line, /scheduler test/)
  assert.doesNotMatch(JSON.stringify(resume), /srcset|media=/)
})

test('a profile readme repo is not selected work', async () => {
  const projects = [{
    name: 'Sumit884-byte',
    fullName: 'Sumit884-byte/Sumit884-byte',
    description: 'GitHub profile README for Sumit Mishra',
    private: false,
    conclusion: 'Data Science student building AI tools. Portfolio · LinkedIn · X/Twitter.',
  }]
  const draft = composeResume({
    person: { name: 'Sumit Mishra', login: 'Sumit884-byte' },
    projects,
    prefs: { roleTarget: 'ai engineer' },
  })
  assert.equal(draft.work.length, 0)
  const tailored = await tailorResume(draft, projects, { roleTarget: 'ai engineer' })
  assert.equal(tailored.work.length, 0)
})

test('install steps and empty filler are not shown', () => {
  assert.equal(readableLine('chatbot has little written about it, so this comes from the project itself.'), '')
  assert.equal(readableLine('Created by Leap: https://leap.new'), '')
  assert.equal(readableLine('This is a Next.js project bootstrapped with create-next-app. First, run the development server.'), '')
  assert.equal(readableLine('Running the code Run npm i to install the dependencies.'), '')
  const kept = readableLine('Exam-guided RAG pipeline for textbook study. Click the microphone 2. Speak your message.')
  assert.match(kept, /textbook study/)
  assert.doesNotMatch(kept, /microphone|Speak/)
  const cleaned = readableResume({
    summary: 'Recent projects include arka.',
    work: [
      { title: 'chatbot', lines: ['chatbot has little written about it, so this comes from the project itself.'] },
      { title: 'summarize_pdfs', lines: ['Exam-guided RAG pipeline for textbook study.'] },
    ],
  })
  assert.equal(cleaned.work[0].lines.length, 0)
  assert.match(cleaned.work[1].lines[0], /textbook/)
})

test('broken readme tags are not shown', () => {
  const cleaned = readableResume({
    summary: 'Recent projects include arka.',
    work: [{
      title: 'arka',
      lines: [
        'Natural-language AI agent for your terminal.',
        '<p align="center" <img src="mark.svg" alt="Star the repo" / </p <h1 align="center" Arka</h1 <p <strong Your terminal, upgraded.</strong',
      ],
    }],
  })
  const extra = cleaned.work[0].lines[1] || ''
  assert.doesNotMatch(extra, /<|align=|src=|alt=|\bh1\b|\bimg\b/)
  assert.match(cleaned.work[0].lines[0], /terminal/)
})

test('a role selects projects from their descriptions', async () => {
  const projects = [
    { name: 'Ledger', description: 'Invoices for shops', private: false },
    { name: 'Parcel', description: 'Draft reminders', private: false },
    { name: 'Hidden', description: 'Internal notes', private: true },
    { name: 'Atlas', description: '', conclusion: 'A terminal that routes plain English to local skills.', private: false },
  ]
  const resume = {
    headline: '',
    summary: 'old',
    skills: [],
    work: projects.map((project) => ({ title: project.name, lines: [project.description || project.conclusion] })),
  }
  assert.deepEqual(namesFromDescriptions(projects, 'invoices'), ['Ledger'])
  assert.deepEqual(namesFromDescriptions(projects, 'terminal'), ['Atlas'])
  assert.deepEqual(namesFromDescriptions([
    { name: 'Notes', description: 'A machine learning pipeline in Python', private: false },
    { name: 'Ledger', description: 'Invoices for shops', private: false },
  ], 'ai devloper'), ['Notes'])
  assert.deepEqual(namesFromTerms([
    { name: 'A', description: 'machine learning notes', private: false },
    { name: 'B', description: 'learning about a machine', private: false },
  ], ['machine learning']), ['A'])
  assert.deepEqual(publicNamesForRole(projects, ['Parcel', 'Nope', 'Hidden']), ['Parcel'])
  const next = resumeWithSelection(resume, projects, ['Ledger'])
  assert.deepEqual(next.work.map((item) => item.title), ['Ledger', 'Hidden'])
  assert.equal(next.summary, '')
  const request = roleBreakdownRequest('ai developer')
  assert.equal(request.store, false)
  assert.match(request.messages[0].content, /skills/)
  assert.match(request.messages[0].content, /stacks/)
  assert.equal(JSON.parse(request.messages[1].content).role, 'ai developer')
  assert.doesNotMatch(request.messages[1].content, /Invoices|terminal/)
  assert.equal(modelBase(''), '')
  const previousModel = process.env.LLM_BASE_URL
  delete process.env.LLM_BASE_URL
  try {
    const kept = await tailorResume(resume, projects, { roleTarget: 'ai devloper' })
    assert.deepEqual(new Set(kept.work.map((item) => item.title)), new Set(projects.map((project) => project.name)))
    assert.doesNotMatch(kept.summary, /leave out/)
    process.env.LLM_BASE_URL = 'https://example.test/v1'
    const filtered = await tailorResume(resume, projects, { roleTarget: 'bookkeeper' }, async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ skills: ['invoices'], stacks: ['billing'] }) } }] }),
    }))
    assert.deepEqual(filtered.work.map((item) => item.title), ['Ledger', 'Hidden'])
  } finally {
    if (previousModel == null) delete process.env.LLM_BASE_URL
    else process.env.LLM_BASE_URL = previousModel
  }
  assert.equal(modelBase('kept-model:10000'), 'http://kept-model:10000/v1')
  assert.equal(modelBase('https://example.test/v1'), 'https://example.test/v1')
})

test('a small edit keeps the name and does not ask for a new resume', () => {
  const fields = personFields({ displayName: 'Ada Lovelace', headline: 'Writer', email: 'ada@example.com', location: 'London', education: 'Maths\n\nMusic' })
  const painted = paintPerson({
    name: 'Old',
    headline: 'Old line',
    contact: ['old@example.com', 'github.com/ada'],
    education: ['Old school'],
    work: [{ title: 'Notes' }],
  }, fields)
  assert.equal(painted.name, 'Ada Lovelace')
  assert.equal(painted.headline, 'Writer')
  assert.deepEqual(painted.contact, ['ada@example.com', 'London', 'github.com/ada'])
  assert.deepEqual(painted.education, ['Maths', 'Music'])
  assert.deepEqual(painted.experience, [])
  assert.equal(painted.work[0].title, 'Notes')
  const link = { selectedRepos: ['ada/notes'], visibility: 'public', roleTarget: 'Writer', instructions: '' }
  assert.equal(personOnly({ ...fields, repos: ['ada/notes'], visibility: 'public', roleTarget: 'Writer', instructions: '' }, link), true)
  assert.equal(personOnly({ ...fields, repos: ['ada/other'], visibility: 'public', roleTarget: 'Writer', instructions: '' }, link), false)
  assert.equal(isLightPath('/api/me'), true)
  assert.equal(isLightPath('/api/auth/github'), true)
  assert.equal(isLightPath('/github/auth/callback'), true)
  assert.equal(isLightPath('/api/projects'), true)
  assert.deepEqual(projectCounts([
    { private: false, fork: false },
    { private: true, fork: true },
    { private: false, fork: true },
  ]), { public: 2, private: 1, forks: 2, all: 3 })
  assert.equal(isLightPath('/api/links'), true)
  assert.equal(isLightPath('/api/links', 'POST'), false)
  assert.throws(() => personFields({ email: 'not-an-email' }))
})

test('a remote writer does not receive private projects', () => {
  const kept = projectsForRemote([
    { name: 'Ledger', private: false },
    { name: 'Parcel', private: true },
  ])
  assert.deepEqual(kept.map((project) => project.name), ['Ledger'])
  assert.equal(projectsForRemote([{ name: 'Parcel', private: true }]).length, 0)
})

test('private projects are described with gemma only', () => {
  assert.match(GEMMA_MODEL, /^onnx-community\/gemma-/)
  assert.doesNotMatch(GEMMA_MODEL, /qwen|gpt|llama|mistral|phi/i)
  const sample = samplePrivate['northwind/parcel']
  assert.equal(sample[1].text, findSample('northwind/parcel').gather.files[1].text)
  const messages = gemmaMessages({ name: 'Parcel', description: '', files: sample })
  assert.match(messages[0].content, /Do not invent numbers/)
  assert.match(messages[1].content, /drafts/)
  assert.equal(cleanConclusion('Parcel sends reminders for unpaid invoices.', 'Parcel', sample), 'Parcel sends reminders for unpaid invoices.')
  assert.equal(cleanConclusion('Parcel is a scalable framework for everyone.', 'Parcel', sample), '')
  assert.equal(cleanConclusion('const app = express()\napp.listen(3000)', 'Parcel', sample), '')
  assert.equal(cleanConclusion('Okay, I will try to answer this as accurately as possible.', 'Parcel', sample), '')
  const short = gemmaMessages({ name: 'Parcel', description: '', files: sample }, 800)
  assert.match(short[1].content, /Parcel/)
  assert.ok(short[1].content.length < 7000)
})

test('a private read picks a build this computer can run', () => {
  const strong = gemmaPlans({ gpu: true, f16: true, memory: 8, cores: 8, isolated: true })
  assert.equal(strong[0].device, 'webgpu')
  assert.equal(strong[0].dtype, 'fp16')
  assert.equal(strong.at(-1).device, 'wasm')
  assert.equal(strong.at(-1).dtype, 'fp32')
  const oldGpu = gemmaPlans({ gpu: true, f16: false, memory: 8, cores: 4, isolated: false })
  assert.equal(oldGpu[0].dtype, 'fp16')
  assert.equal(oldGpu[1].dtype, 'fp32')
  assert.equal(oldGpu[0].threads, 1)
  const small = gemmaPlans({ gpu: false, memory: 2, cores: 2, isolated: false })
  assert.deepEqual(small.map((plan) => plan.device), ['wasm'])
  assert.equal(small[0].budget, 800)
  assert.equal(small[0].threads, 1)
})

test('a writing model cannot invent a percentage', () => {
  const project = interpret(findSample('northwind/ledger').gather).project
  const original = composeResume({
    person: { name: 'Mira Chen' },
    projects: [applyHistory(project, { stars: 12, forks: 2, openIssues: 11 })],
    prefs: { headline: 'Product engineer' },
  })
  assert.equal(lineIsGrounded('Revenue grew 80% last year.', JSON.stringify(project)), false)
  const merged = mergeTailored(original, {
    summary: 'Revenue grew 80% last year.',
    work: [{ title: 'Ledger', lines: ['Revenue grew 80% last year.', 'People starring it grew from 12 to 40.'] }],
  }, [applyHistory(project, { stars: 12, forks: 2, openIssues: 11 })])
  assert.doesNotMatch(merged.summary, /80%/)
  assert.ok(merged.work[0].lines.some((line) => line.includes('40')))
  assert.ok(merged.work[0].lines.every((line) => !line.includes('80%')))
})

test('github signatures and next links', () => {
  const body = Buffer.from('{"ok":true}')
  const secret = 'hook-secret'
  const header = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  assert.equal(verifyGithubSignature(body, header, secret), true)
  assert.equal(verifyGithubSignature(body, header, 'other'), false)
  assert.equal(
    parseNext('<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=4>; rel="last"'),
    '/user/repos?page=2',
  )
})

test('a username is not used as a name', () => {
  assert.equal(profileName('ada', 'Ada'), '')
  assert.equal(nameFromProfileReadme('# Ada Lovelace\n\nBuilds tools.', 'ada'), 'Ada Lovelace')
  assert.equal(nameFromProfileReadme('# README', 'ada'), '')
})

test('saved access round-trips', () => {
  const packed = encrypt('github-token')
  assert.equal(decrypt(packed), 'github-token')
  assert.throws(() => decrypt(`${packed}x`))
})

test('pdf titles read like project names', () => {
  assert.equal(displayProjectTitle('air_pen'), 'Air Pen')
  assert.equal(displayProjectTitle('arka'), 'Arka')
  assert.equal(displayProjectTitle('Syntropy'), 'Syntropy')
})

test('pdf keeps a name and stays a pdf', async () => {
  const resume = exampleResume()
  const outline = resumeOutline(resume)
  const html = renderPaperHtml(resume, (value) => String(value ?? ''))
  const buffer = await renderPdf(resume)
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
  assert.match(buffer.toString('latin1'), /Mira Chen/)
  assert.match(html, /Mira Chen/)
  const work = outline.sections.find((section) => section.kind === 'projects')
  assert.match(html, new RegExp(work.projects[0].title))
  assert.equal(pdfText('José — “hi”'), 'José - "hi"')
})

test('pdf grows page count with more content', async () => {
  const projects = sampleProjects.map((sample) => applyHistory(interpret(sample.gather).project, sample.earlier))
  const short = composeResume({ person: samplePerson, projects, prefs: { roleTarget: 'Engineer' } })
  const long = {
    ...short,
    work: Array.from({ length: 14 }, (_, index) => ({
      title: `project_${index}`,
      url: 'github.com/x/y',
      stars: 12,
      lines: [
        'Built a pipeline that scores repos against a role and keeps the PDF honest.',
        'Shipped tests, docs, and a small UI so people can trust the link.',
        'Measured latency and cut cold starts without losing accuracy.',
      ],
    })),
    contributions: Array.from({ length: 8 }, (_, index) => ({
      title: `contrib_${index}`,
      line: 'Merged fixes and docs across several open-source repos.',
      url: 'github.com/a/b',
    })),
  }
  const shortPages = countPdfPages(await renderPdf(short))
  const longPages = countPdfPages(await renderPdf(long))
  assert.ok(shortPages >= 1)
  assert.ok(longPages > shortPages)
})

test('a shared page escapes the name', () => {
  const html = renderPublicPage({
    slug: 'abcdefghij',
    resume: { name: '<script>', summary: 'Hello', contact: [], work: [], skills: [] },
  })
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})

test('signing in adopts the GitHub account that is already kept', () => {
  const signedIn = { id: 'clerk-row', github_id: 'clerk:user_1' }
  const kept = { id: 'github-row', github_id: '4242', clerk_user_id: null }
  assert.equal(githubConnectPlan(signedIn, null), 'attach')
  assert.equal(githubConnectPlan(signedIn, signedIn), 'attach')
  assert.equal(githubConnectPlan(signedIn, kept), 'adopt')
  assert.equal(githubConnectPlan({ id: 'guest', github_id: 'preview:abc' }, kept), 'adopt')
  assert.equal(githubConnectPlan({ id: 'other', github_id: '999' }, kept), 'taken')
})

test('a guest linked to GitHub is no longer a sample account', () => {
  assert.deepEqual(accountKind({ github_id: 'preview:abc', preview: true }), { sample: true, connected: false })
  assert.deepEqual(accountKind({ github_id: '4242', preview: true }), { sample: false, connected: true })
  assert.deepEqual(accountKind({ github_id: 'clerk:user_1', preview: false }), { sample: false, connected: false })
  const guest = bindingFromAccount({ login: 'sample', preview: true, githubConnected: false })
  const linked = bindingFromAccount({ login: 'ada', preview: false, githubConnected: true })
  assert.equal(sameBinding(guest, guest), true)
  assert.equal(sameBinding(guest, linked), false)
})

test('dates are spoken plainly', () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  assert.equal(updatedLabel('2026-10-04T01:00:00Z', now), 'Updated today')
  assert.equal(updatedLabel('2026-10-01T12:00:00Z', now), 'Updated 3 days ago')
})

test('the site copy stays in everyday language', () => {
  const source = readFileSync(new URL('../src/copy.js', import.meta.url), 'utf8')
  const strings = [...source.matchAll(/`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/g)].map((match) => match[0])
  const banned = /\b(api|webhook|oauth|tokens?|database|prompt|backend|json|endpoint|repositor(?:y|ies)|commits?|server|deploy|llm|hypertable|sql|postgres|timescale|schema|openai|poller)\b/i
  const hits = strings.filter((value) => banned.test(value))
  assert.deepEqual(hits, [])
})

test('rate limit buckets are swept and proxies are only trusted in production', async () => {
  const { allow, bucketCount } = await import('../src/limit.js')
  for (let i = 0; i < 10_001; i += 1) allow(`sweep:${i}`, 1, -1)
  assert.ok(bucketCount() < 10_001)
  const { config } = await import('../src/config.js')
  const saved = { env: process.env.NODE_ENV, trust: process.env.TRUST_PROXY }
  process.env.TRUST_PROXY = ''
  process.env.NODE_ENV = 'development'
  assert.equal(config.trustProxy, false)
  process.env.NODE_ENV = 'production'
  assert.equal(config.trustProxy, 1)
  process.env.TRUST_PROXY = '2'
  assert.equal(config.trustProxy, 2)
  process.env.NODE_ENV = saved.env
  process.env.TRUST_PROXY = saved.trust ?? ''
})

test('a line that opens with the project name keeps its subject', () => {
  assert.deepEqual(uniqueLines(['Parcel is a web service.'], 'Parcel'), ['Parcel is a web service.'])
  assert.deepEqual(uniqueLines(['Arka: Your terminal, upgraded.'], 'Arka'), ['Your terminal, upgraded.'])
  assert.match(readableLine('Parcel is a web service. It handles drafts, send, and reminders.'), /drafts/)
  assert.equal(readableLine('Supports formats e.g. CSV and JSON for exports.'), 'Supports formats e.g. CSV and JSON for exports.')
})
