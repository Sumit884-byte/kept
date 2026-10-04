import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assessReadme, actionsFrom, humanAction, interpret } from '../src/analyze.js'
import { applyHistory } from '../src/history.js'
import { enhancementSentence, soften } from '../src/phrases.js'
import { composeResume, readableResume, uniqueLines } from '../src/resume.js'
import { lineIsGrounded, mergeTailored, namesFromDescriptions, projectsForRemote, publicNamesForRole, resumeWithSelection, roleChoiceRequest } from '../src/tailor.js'
import { GEMMA_MODEL, cleanConclusion, gemmaMessages } from '../src/public/gemmaText.js'
import { samplePrivate } from '../src/public/samplePrivate.js'
import { findSample } from '../src/sample.js'
import { exampleResume } from '../src/example.js'
import { verifyGithubSignature, parseNext, profileName, nameFromProfileReadme } from '../src/github.js'
import { encrypt, decrypt } from '../src/cryptoBox.js'
import { pdfText, renderPdf } from '../src/pdf.js'
import { renderPublicPage } from '../src/publicPage.js'
import { modelBase } from '../src/config.js'
import { updatedLabel } from '../src/when.js'

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

test('a role selects projects from their descriptions', () => {
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
  assert.deepEqual(publicNamesForRole(projects, ['Parcel', 'Nope', 'Hidden']), ['Parcel'])
  const next = resumeWithSelection(resume, projects, ['Ledger'])
  assert.deepEqual(next.work.map((item) => item.title), ['Ledger', 'Hidden'])
  assert.equal(next.summary, '')
  const request = roleChoiceRequest(projects, 'invoices')
  assert.equal(request.store, false)
  assert.match(request.messages[1].content, /Invoices for shops/)
  assert.match(request.messages[1].content, /terminal that routes/)
  assert.equal(modelBase(''), '')
  assert.equal(modelBase('kept-model:10000'), 'http://kept-model:10000/v1')
  assert.equal(modelBase('https://example.test/v1'), 'https://example.test/v1')
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

test('pdf keeps a name and stays a pdf', async () => {
  const resume = exampleResume()
  const buffer = await renderPdf(resume)
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
  assert.match(buffer.toString('latin1'), /Mira Chen/)
  assert.equal(pdfText('José — “hi”'), 'José - "hi"')
})

test('a shared page escapes the name', () => {
  const html = renderPublicPage({
    slug: 'abcdefghij',
    resume: { name: '<script>', summary: 'Hello', contact: [], work: [], skills: [] },
  })
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
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
