import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
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
import { resumeAs, resumeJson, resumeMarkdown, resumePlainText } from '../src/resumeText.js'
import { modelBase } from '../src/config.js'
import { opensLabel, opensShort, updatedLabel } from '../src/when.js'
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
  assert.equal(verifyGithubSignature(body, header.toUpperCase().replace('SHA256=', 'sha256='), secret), true)
  assert.equal(verifyGithubSignature(body, [header], secret), false)
  assert.equal(verifyGithubSignature(body, header, 'other'), false)
  assert.equal(
    parseNext('<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=4>; rel="last"'),
    '/user/repos?page=2',
  )
})

test('hidden paths are not the app shell', async () => {
  const { isHiddenPath } = await import('../src/hiddenPath.js')
  assert.equal(isHiddenPath('/.env'), true)
  assert.equal(isHiddenPath('/.git/config'), true)
  assert.equal(isHiddenPath('/.well-known/acme-challenge/token'), false)
  assert.equal(isHiddenPath('/links'), false)
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
  const editing = renderPaperHtml(resume, (value) => String(value ?? ''), { editing: true })
  assert.match(editing, /<span class="paper-edit"/)
  assert.doesNotMatch(editing, /<(textarea|input) class="paper-edit"/)
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

test('a malformed cookie value reads as empty instead of throwing', async () => {
  const { decodeCookieValue, readSessionCookie } = await import('../src/sessionCookie.js')
  assert.equal(decodeCookieValue('%E0%A4%A'), '')
  assert.equal(decodeCookieValue('abc%20d'), 'abc d')
  assert.equal(readSessionCookie({ headers: { cookie: 'kept_session=%E0%A4%A' } }), '')
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

test('a model conclusion keeps typographic punctuation and a non-Latin project name', () => {
  assert.equal(cleanConclusion('Parcel’s service sends reminders daily.', 'Parcel'), "Parcel's service sends reminders daily.")
  assert.equal(cleanConclusion('Parcel — sends invoice reminders daily.', 'Parcel'), 'Parcel - sends invoice reminders daily.')
  assert.equal(cleanConclusion('Проект is a tool for invoices.', 'Проект'), 'Проект is a tool for invoices.')
  assert.equal(cleanConclusion('Parcel 是一个 tool for invoices.', 'Parcel'), '')
})

test('a line that opens with the project name keeps its subject', () => {
  assert.deepEqual(uniqueLines(['Parcel is a web service.'], 'Parcel'), ['Parcel is a web service.'])
  assert.deepEqual(uniqueLines(['Arka: Your terminal, upgraded.'], 'Arka'), ['Your terminal, upgraded.'])
  assert.match(readableLine('Parcel is a web service. It handles drafts, send, and reminders.'), /drafts/)
  assert.equal(readableLine('Supports formats e.g. CSV and JSON for exports.'), 'Supports formats e.g. CSV and JSON for exports.')
})

const PDF_LINK = 'https://kept.example/r/abcdefghij.pdf'
const PDF_HEADINGS = new Set(['EXPERIENCE', 'EDUCATION', 'SKILLS', 'RELEVANT WORKS', 'CONTRIBUTIONS'])

// The text of each page of a PDF, in the order it was drawn.
function pdfPageTexts(buffer) {
  const raw = buffer.toString('latin1')
  const pages = []
  for (const found of raw.matchAll(/<<([^>]*(?:>(?!>)[^>]*)*)>>\s*stream\r?\n/g)) {
    const length = Number((found[1].match(/\/Length (\d+)/) || [])[1])
    if (!length) continue
    const start = found.index + found[0].length
    let drawn
    try {
      drawn = inflateSync(buffer.subarray(start, start + length)).toString('latin1')
    } catch {
      continue
    }
    if (!/\bBT\b/.test(drawn)) continue
    pages.push([...drawn.matchAll(/\[((?:<[0-9a-fA-F]*>|[^\]])*)\]\s*TJ/g)].map((run) => (
      Buffer.from([...run[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((part) => part[1]).join(''), 'hex').toString('latin1')
    )))
  }
  return pages
}

// The headings that end a page with nothing under them, in a resume long enough to need a second page.
async function loneHeadings(template, experienceCount) {
  const line = 'Rebuilt the invoice export so a month of records downloads in seconds instead of minutes for every shop.'
  const pages = pdfPageTexts(await renderPdf({
    ...exampleResume(),
    template,
    liveUrl: PDF_LINK,
    experience: Array.from({ length: experienceCount }, (_, index) => `Company ${index + 1}, engineer, ${2000 + index}: shipped the thing people asked for`),
    work: ['Ledger', 'Parcel', 'Relay'].map((title) => ({ title, url: `github.com/northwind/${title.toLowerCase()}`, stars: 3, lines: [line, line] })),
  }))
  assert.ok(pages.length > 1)
  return pages.slice(0, -1)
    .map((page) => page.filter((text) => text.trim() && text !== PDF_LINK).pop())
    .filter((last) => PDF_HEADINGS.has(last))
}

test('a section heading stays on the page of its first entry', async () => {
  for (const count of [5, 24, 29]) assert.deepEqual(await loneHeadings('classic', count), [])
})

test('the same resume is written as markdown, plain text and a data file', () => {
  const resume = {
    ...exampleResume(),
    name: 'Mira Chen',
    contact: ['mira@example.com', 'Lisbon', 'mira.dev', 'github.com/mira'],
    experience: ['# Kept, product engineer, 2024', '1. Northwind, engineer', '3) Shops', '---', '~~~ notes', '3.5x faster exports'],
    liveUrl: PDF_LINK,
  }
  const outline = resumeOutline(resume)
  const titles = outline.sections.flatMap((section) => (section.projects || []).map((item) => item.title))
  assert.ok(titles.length)

  const markdown = resumeMarkdown(resume)
  assert.match(markdown, /^# Mira Chen\n/)
  assert.match(markdown, /\n## Skills\n/)
  for (const title of titles) assert.ok(markdown.includes(`### ${title}`))
  assert.deepEqual(markdown.split('\n').filter((line) => line.startsWith('- ')).slice(0, 6), [
    '- \\# Kept, product engineer, 2024',
    '- 1\\. Northwind, engineer',
    '- 3\\) Shops',
    '- \\---',
    '- \\~~~ notes',
    '- 3.5x faster exports',
  ])

  const text = resumePlainText(resume)
  assert.match(text, /^Mira Chen\nmira@example\.com \| Lisbon/)
  assert.match(text, /\nSKILLS\n/)
  for (const title of titles) assert.ok(text.includes(`\n${title}`))
  assert.ok(text.trimEnd().endsWith(PDF_LINK))

  const json = JSON.parse(resumeJson(resume))
  assert.equal(json.basics.name, 'Mira Chen')
  assert.equal(json.basics.email, 'mira@example.com')
  assert.equal(json.basics.url, 'https://mira.dev')
  assert.deepEqual(json.basics.location, { address: 'Lisbon' })
  assert.equal(json.basics.profiles[0].username, 'mira')
  assert.deepEqual(json.work[0], { summary: '# Kept, product engineer, 2024' })
  assert.deepEqual(json.projects.map((item) => item.name), titles)
  assert.deepEqual(json.skills.map((item) => item.name), resume.skills)
  const basics = (contact, place) => JSON.parse(resumeJson({ ...resume, contact, place })).basics
  assert.deepEqual(basics(['mira@example.com', '127.0.0.1', 'mira.dev', 'github.com/mira']).location, { address: '127.0.0.1' })
  assert.equal(basics(['mira@example.com', '127.0.0.1', 'mira.dev', 'github.com/mira']).url, 'https://mira.dev')
  assert.deepEqual(basics(['mira@example.com', 'St.Petersburg', 'github.com/mira'], 'St.Petersburg').location, { address: 'St.Petersburg' })
  assert.equal(basics(['mira@example.com', 'St.Petersburg', 'github.com/mira'], 'St.Petersburg').url, undefined)
  assert.equal(basics(['mira@example.com', 'mira.dev', 'github.com/mira'], 'Lisbon').url, 'https://mira.dev')
  assert.equal(basics(['mira@example.com', 'mira.dev', 'github.com/mira'], 'Lisbon').location, undefined)
  assert.equal(basics(['mira@example.com', 'MiraChen.dev', 'github.com/mira'], '').url, 'https://MiraChen.dev')
  assert.equal(basics(['mira@example.com', 'MiraChen.dev', 'github.com/mira'], '').location, undefined)

  assert.deepEqual(
    ['md', 'txt', 'json'].map((format) => resumeAs(resume, format).name),
    ['Mira-Chen.md', 'Mira-Chen.txt', 'Mira-Chen.json'],
  )
  assert.match(resumeAs(resume, 'md').type, /^text\/markdown/)
})

test('a resume page links to its other versions', () => {
  const page = renderPublicPage({ slug: 'abcdefghij', resume: exampleResume() })
  assert.match(page, /href="\/r\/abcdefghij\.md">Markdown</)
  assert.match(page, /href="\/r\/abcdefghij\.txt">Plain text</)
  assert.match(page, /href="\/r\/abcdefghij\.json">Data file</)
})

test('a link unfurler or a script is not counted as a reader', async () => {
  const { isAutomated } = await import('../src/automated.js')
  const people = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20 PRO Build/RP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [LinkedInApp]',
  ]
  const machines = [
    '',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'curl/8.7.1',
    'python-requests/2.32.3',
    'Python/3.11 aiohttp/3.9.5',
    'node',
    'axios/1.7.2',
    'okhttp/4.12.0',
    'Java/17.0.2',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  ]
  for (const agent of people) assert.equal(isAutomated(agent), false, agent)
  for (const agent of machines) assert.equal(isAutomated(agent), true, agent)
  assert.equal(isAutomated(undefined), true)
})

test('open counts read as a plain sentence', () => {
  const now = Date.parse('2026-10-11T12:00:00Z')
  assert.equal(opensLabel(null, now), '')
  assert.equal(opensLabel({ total: 0 }, now), '')
  assert.equal(opensLabel({ total: 1, week: 1, last: '2026-10-11T09:00:00Z' }, now), 'Opened once, all in the last 7 days. Last opened today.')
  assert.equal(opensLabel({ total: 14, week: 3, last: '2026-10-10T09:00:00Z' }, now), 'Opened 14 times, 3 in the last 7 days. Last opened yesterday.')
  assert.equal(opensLabel({ total: 5000, week: 1200, last: '2026-10-11T09:00:00Z' }, now), 'Opened 5,000 times, 1,200 in the last 7 days. Last opened today.')
  assert.equal(opensLabel({ total: 1200, week: 0, last: '2026-08-01T09:00:00Z' }, now), 'Opened 1,200 times. Last opened 2 months ago.')
  assert.equal(opensShort({ total: 2 }), 'Opened 2 times')
  assert.equal(opensShort(undefined), '')
  assert.equal(updatedLabel('2026-10-06T12:00:00Z', now), 'Updated 5 days ago')
  assert.equal(updatedLabel('2026-10-11T12:00:00Z', now), 'Updated today')
  assert.equal(updatedLabel('2025-01-01T12:00:00Z', now), 'Updated 2 years ago')
  assert.equal(updatedLabel('', now), '')
})

test('the plain look draws the same outline in a serif face', async () => {
  const resume = { ...exampleResume(), liveUrl: PDF_LINK }
  const classic = await renderPdf(resume)
  const plain = await renderPdf({ ...resume, template: 'plain' })
  const unknown = await renderPdf({ ...resume, template: 'neon' })
  assert.match(classic.toString('latin1'), /Helvetica/)
  assert.doesNotMatch(classic.toString('latin1'), /Times-Roman/)
  assert.match(plain.toString('latin1'), /Times-Roman/)
  assert.doesNotMatch(plain.toString('latin1'), /Helvetica/)
  assert.match(unknown.toString('latin1'), /Helvetica/)
  assert.equal(countPdfPages(plain), 1)
  const words = (buffer) => pdfPageTexts(buffer).flat().filter((text) => /[A-Za-z]{3}/.test(text) && !text.includes('@'))
  assert.deepEqual(words(plain), words(classic))
  for (const count of [8, 24, 28]) assert.deepEqual(await loneHeadings('plain', count), [])
})

test('the page version of a resume follows its look', () => {
  const resume = { ...exampleResume(), liveUrl: PDF_LINK }
  const esc = (value) => String(value)
  assert.equal(resumeOutline({ ...resume, template: 'plain' }).template, 'plain')
  assert.equal(resumeOutline(resume).template, 'classic')
  assert.equal(resumeOutline({ ...resume, template: 'neon' }).template, 'classic')
  assert.match(renderPaperHtml({ ...resume, template: 'plain' }, esc), /class="paper paper-classic paper-plain"/)
  assert.match(renderPaperHtml(resume, esc), /class="paper paper-classic"/)
  assert.match(renderPublicPage({ slug: 'abcdefghij', resume }), /class="paper paper-classic public-paper"/)
  assert.match(renderPublicPage({ slug: 'abcdefghij', resume: { ...resume, template: 'plain' } }), /class="paper paper-classic paper-plain public-paper"/)
  // The service loads this file too, and the Vercel bundler leaves out a file that is imported by an address with a query.
  const paper = readFileSync(new URL('../src/public/paperHtml.js', import.meta.url), 'utf8')
  assert.deepEqual([...paper.matchAll(/from '([^']+)'/g)].map((found) => found[1]), ['./resumeOutline.js'])
})

test('a look that is not on the list is saved as classic', () => {
  assert.equal(personFields({ template: 'plain' }).template, 'plain')
  assert.equal(personFields({ template: 'neon' }).template, 'classic')
  assert.equal(personFields({}).template, undefined)
})

test('a job posting is compared with what this version shows', async () => {
  const { leadSentence, matchPosting, postingTerms, resumeEvidence, shows } = await import('../src/postingMatch.js')
  const asked = (posting) => postingTerms(posting).map((term) => term.name)
  const posting = `We are hiring a product engineer. You will express ideas clearly and move at a swift pace.
    You have shipped React and TypeScript, know PostgreSQL, and have run services on AWS with Kubernetes.
    Experience with Go, CI/CD and REST APIs is a plus. Java is not required.`
  assert.deepEqual(asked(posting), ['React', 'TypeScript', 'PostgreSQL', 'AWS', 'Kubernetes', 'Go', 'CI/CD', 'REST', 'Java'])
  for (const [text, tools] of [
    ['We use Node and Express.', ['Node.js', 'Express']],
    ['Experience with Node.js and Express.js is required.', ['Node.js', 'Express']],
    ['We write Golang services. Backend written in Go.', ['Go']],
    ['- Go\n- Express\n- React', ['Go', 'Express', 'React']],
    ['Requirements\n- Strong experience with Go\n- Familiarity with Kubernetes and AWS', ['Go', 'Kubernetes', 'AWS']],
    ['What you bring\n• 3+ years of Node\n• Comfortable with Express\n• Bonus: Spring', ['Node.js', 'Express', 'Spring']],
    ['Backend: Go\nFrontend: React, TypeScript', ['Go', 'React', 'TypeScript']],
    ['1. Go', ['Go']],
    ['Go is our main backend language. React is used on the front.', ['Go', 'React']],
    ['Machine Learning Engineer', ['Machine learning']],
    ['Java, Spring Boot, Hibernate', ['Java', 'Spring']],
    ['Java, Spring, Spring Boot, Hibernate', ['Java', 'Spring']],
    ['Experience with Spring and Spring Boot is required.', ['Spring']],
    ['Long-term Spring Boot experience', ['Spring']],
    ['Kotlin + Spring', ['Kotlin', 'Spring']],
    ['Experience in Spring and Hibernate', ['Spring']],
    ['C#, ASP.NET Core and SQL Server', ['C#', '.NET', 'SQL']],
    ['Strong SQL skills; NoSQL is a plus', ['SQL']],
    ['looking for a senior react developer', ['React']],
    ["we're a small team using react and node on aws", ['React', 'AWS']],
    ['REQUIREMENTS: 3+ YEARS OF REACT AND TYPESCRIPT', ['React', 'TypeScript']],
    ['python, django, flask', ['Python', 'Django', 'Flask']],
    ['python and flask', ['Python', 'Flask']],
    ['Full Stack Engineer, React & Node', ['React', 'Node.js']],
    ['Swift and SwiftUI on iOS. Rust is a plus. Ruby on Rails apps.', ['Swift', 'Rust', 'Ruby', 'Rails']],
  ]) assert.deepEqual(asked(text), tools, text)
  for (const prose of [
    'Be kind, go far, and react well to feedback.',
    'You react quickly to changing priorities.',
    'React quickly to changing priorities.',
    'We are committed to an accessible interview process.',
    'You will build payment rails for merchants.',
    'Express yourself, then rest. Spring 2027 start.',
    'Software Engineering Intern (Spring/Summer 2027)',
    'Internships run in Spring, Summer and Fall.',
    'Start date: Spring\nLocation: Remote',
    'Graduating in Spring or later.',
    'Spring is when our cohort starts.',
    'Join the team at American Express.',
    'Each Node: 16 cores',
    'Keep water in a flask\nat your desk.',
    'You watch how customers react\nand adjust the plan.',
    'Go to market with us. Go and see our blog.',
  ]) assert.deepEqual(asked(prose), [], prose)
  for (const both of [
    'Requirements: Java, Spring, Hibernate',
    'We use Node and Express.',
    'Experience with ReactJS and ExpressJS',
    'SwiftUI on iOS',
    'Skills: Go, Rust, Ruby, Flask',
    'Rails developer',
  ]) assert.deepEqual(matchPosting(both, both).missing, [], both)
  const started = performance.now()
  for (const hostile of ['spring, '.repeat(2500), 'Go and or '.repeat(2000), ' ,'.repeat(10000), '- '.repeat(10000)]) postingTerms(hostile)
  assert.ok(performance.now() - started < 2000)

  const resume = {
    headline: 'Product engineer',
    skills: ['TypeScript', 'React'],
    experience: ['Northwind, engineer: moved the deploy to GitHub Actions'],
    work: [{ title: 'Ledger', lines: ['Invoices kept in Postgres behind a RESTful service.'] }],
    contributions: [{ title: 'shops/ledger', line: 'Add a checklist' }],
  }
  const evidence = resumeEvidence(resume, [{ name: 'relay', description: 'A queue worker', language: 'Go' }])
  assert.deepEqual(matchPosting(posting, evidence), {
    covered: ['React', 'TypeScript', 'PostgreSQL', 'Go', 'CI/CD', 'REST'],
    missing: ['AWS', 'Kubernetes', 'Java'],
  })
  assert.deepEqual(matchPosting(posting, resumeEvidence(resume)).missing, ['AWS', 'Kubernetes', 'Go', 'Java'])
  assert.deepEqual(matchPosting('', evidence), { covered: [], missing: [] })
  for (const [wanted, line, covered] of [
    ['Build REST APIs for partners.', 'Keys are encrypted at rest and rotated weekly.', []],
    ['Strong SQL skills required.', 'Stores events in a NoSQL document store.', []],
    ['Experience with WCAG and accessibility audits', 'Makes invoices accessible from any device.', []],
    ['Java and Spring Boot', 'B.Sc., spring 2023', []],
    ['Java and Spring Boot', 'Teaching Assistant, Spring Semester 2023', []],
    ['Java and Spring Boot', 'CS61B-Spring-2022', []],
    ['Java and Spring Boot', 'A Java service on Spring', ['Java', 'Spring']],
    ['Experience with machine learning', 'Measures 250 ml doses.', []],
    ['Experience with .NET and SQL', 'An ASP.NET Core site on PostgreSQL', ['.NET', 'SQL']],
    ['Strong SQL skills', 'PLpgSQL', ['SQL']],
    ['Strong SQL skills', 'TSQL', ['SQL']],
    ['Strong SQL skills', 'GraphQL', []],
  ]) assert.deepEqual(matchPosting(wanted, line).covered, covered, `${wanted} / ${line}`)
  assert.deepEqual(matchPosting('We use Git', resumeEvidence({ work: [{ title: 'Vault', lines: ['Anything at all'] }] })).covered, ['Git'])
  assert.deepEqual(matchPosting('We use Git', resumeEvidence({ headline: 'Engineer' })).missing, ['Git'])

  assert.equal(shows('Go', 'A worker written in Go'), true)
  assert.equal(shows('go', 'Let us go'), false)
  assert.equal(shows('interface', 'A new interface for shops'), true)
  assert.equal(shows('face', 'A new interface for shops'), false)
  assert.equal(shows('React', 'Reactive streams'), false)
  assert.equal(shows('Spring', 'CS61B-Spring-2022'), false)
  assert.equal(leadSentence(['React']), 'Lead with React.')
  assert.equal(leadSentence(['React', 'Go', 'REST']), 'Lead with React, Go and REST.')
  assert.equal(leadSentence([]), '')
})

test('a brief can say what to lead with', async () => {
  const { leadPhrases, neverPhrases } = await import('../src/brief.js')
  const { leadSentence } = await import('../src/postingMatch.js')
  assert.deepEqual(leadPhrases('Lead with interface work and the results. Leave out internal tooling.'), ['interface', 'results'])
  assert.deepEqual(leadPhrases(leadSentence(['Node.js', 'C++', 'C#', '.NET', 'CI/CD', 'Machine learning'])), ['Node.js', 'C++', 'C#', '.NET', 'CI/CD', 'Machine learning'])
  for (const [brief, phrases] of [
    ['First person. Lead with Node.js and Go.', ['Node.js', 'Go']],
    ['- First person\n- Lead with Go', ['Go']],
    ['Keep it short and lead with the billing work.', ['billing']],
    ['First person, lead with Go.', ['Go']],
    ['You should lead with Go.', ['Go']],
    ['Please always lead with Go', ['Go']],
    ['Lead with React. Lead with Go.', ['React', 'Go']],
    ['Lead with Go.\r\nFirst person.', ['Go']],
    ['First person.', []],
    ["Don't lead with PHP.", []],
    ['Do not lead with the PHP projects. First person.', []],
    ['Never lead with PHP', []],
    ['You should not lead with Go.', []],
    ["I'm an engineering lead with a focus on platform and data work.", []],
  ]) assert.deepEqual(leadPhrases(brief), phrases, brief)
  const banned = 'Never mention bakery'
  assert.deepEqual(neverPhrases(`${banned}\n${leadSentence(['Go', 'PostgreSQL'])}`), neverPhrases(banned))

  const projects = [
    { name: 'alpha', fullName: 'm/alpha', description: 'A static site for a bakery', conclusion: 'Alpha is a static site for a bakery.', highlights: [], language: 'HTML', numbers: { stars: 30 } },
    { name: 'beta', fullName: 'm/beta', description: 'A Django backend that keeps reports in PostgreSQL for the finance team', conclusion: 'Beta keeps reports in PostgreSQL for the finance team.', highlights: [], language: 'Python', numbers: {} },
    { name: 'gamma', fullName: 'm/gamma', description: 'A backend queue worker', conclusion: 'Gamma is a queue worker.', highlights: [], language: 'Go', numbers: {} },
  ]
  const written = (prefs) => composeResume({ person: { name: 'Mira' }, projects, prefs }).work.map((item) => item.title)
  assert.deepEqual(written({ roleTarget: '', instructions: '' }), ['alpha', 'beta', 'gamma'])
  assert.deepEqual(written({ roleTarget: '', instructions: leadSentence(['PostgreSQL']) }), ['beta', 'alpha', 'gamma'])
  assert.deepEqual(written({ roleTarget: '', instructions: leadSentence(['Go']) }), ['gamma', 'alpha', 'beta'])
  assert.deepEqual(written({ roleTarget: '', instructions: 'Do not lead with Go.' }), ['alpha', 'beta', 'gamma'])
  assert.deepEqual(written({ roleTarget: '', instructions: `${banned}\n${leadSentence(['Go'])}` }), ['gamma', 'beta'])

  const forRole = async (instructions) => {
    const prefs = { roleTarget: 'Backend engineer', instructions }
    const tailored = await tailorResume(composeResume({ person: { name: 'Mira' }, projects, prefs }), projects, prefs)
    return tailored.work.map((item) => item.title)
  }
  assert.deepEqual(await forRole(''), ['beta', 'gamma'])
  assert.deepEqual(await forRole(leadSentence(['Go'])), ['gamma', 'beta'])
  assert.deepEqual(await forRole(leadSentence(['Kubernetes'])), ['beta', 'gamma'])
})
