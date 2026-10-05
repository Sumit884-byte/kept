import assert from 'node:assert/strict'
import test from 'node:test'
import { composeResume } from '../src/resume.js'
import { namesFromDescriptions, tailorResume } from '../src/tailor.js'

const projects = [
  { name: 'arka', description: 'Natural-language AI agent for your terminal with LLM failover.', language: 'Python', private: false },
  { name: 'summarize_pdfs', description: 'Exam-guided RAG pipeline for textbook study.', language: 'Python', private: false },
  { name: 'stock_analyzer', description: 'Machine learning models that predict stock direction from news sentiment.', language: 'Python', private: false },
  { name: 'Syntropy', description: 'AI-powered app that transforms handwritten notes into 3D concept maps.', language: 'JavaScript', private: false },
  { name: 'air_pen', description: 'Computer vision app that draws in the air with OpenCV and MediaPipe.', language: 'Python', private: false },
  { name: 'hireability-prediction', description: 'Personalized hireability score from job demand and profile signals.', language: 'Python', private: false },
  { name: 'linkedin_connection_bot', description: 'Automate LinkedIn people search and send connection requests.', language: 'Python', private: false },
  { name: 'gmail_notifier', description: 'Desktop Gmail notifier with multi-account support.', language: 'Python', private: false },
  { name: 'youtube_bulk_downloader', description: 'Web app for bulk-downloading YouTube playlists.', language: 'Python', private: false },
  { name: 'automations', description: 'Python automation toolkit of installers and utility scripts.', language: 'Python', private: false },
  { name: 'rsume-site', description: 'Bento-grid portfolio built with React, Vite, and Tailwind CSS.', language: 'TypeScript', private: false },
  { name: 'threejs_demo', description: 'Landing page built with Next.js, Three.js, and Tailwind CSS.', language: 'TypeScript', private: false },
  { name: 'charts', description: 'Chart gallery built with React, TypeScript, and Vite.', language: 'TypeScript', private: false },
  { name: 'css-samosa-kitchen', description: 'Pure CSS samosa kitchen art for a frontend challenge.', language: 'CSS', private: false },
  { name: 'tasty_noodles', description: 'Comfort food landing page for a frontend challenge.', language: 'HTML', private: false },
  { name: 'beautiful_3d_space', description: 'A React and Three.js solar system with orbit controls.', language: 'JavaScript', private: false },
  { name: 'Sumit884-byte', description: 'GitHub profile README for a student building AI tools and full-stack apps.', language: '', private: false },
  { name: 'computer-history', description: 'Interactive educational site for computing history.', language: 'JavaScript', private: false },
  { name: 'dub_movie', description: 'Automated movie dubbing pipeline with translated speech.', language: 'Python', private: false },
  { name: 'battlebots-analytics', description: 'Dashboard of win rates, sentiment, and predictions.', language: 'Python', private: false },
  { name: 'techfocus', description: 'YouTube lecture watcher with search and playlists.', language: 'TypeScript', private: false },
]

function resumeFor(role) {
  const draft = composeResume({
    person: { name: 'Sumit Mishra', login: 'Sumit884-byte' },
    projects,
    prefs: { roleTarget: role, instructions: '', headline: '' },
  })
  return tailorResume(draft, projects, { roleTarget: role, instructions: '' })
}

const cases = [
  {
    role: 'ai developer',
    include: ['arka', 'summarize_pdfs', 'stock_analyzer', 'Syntropy', 'air_pen'],
    exclude: ['gmail_notifier', 'youtube_bulk_downloader', 'linkedin_connection_bot', 'Sumit884-byte', 'css-samosa-kitchen', 'automations'],
  },
  {
    role: 'ai devloper',
    include: ['arka', 'summarize_pdfs', 'stock_analyzer'],
    exclude: ['gmail_notifier', 'Sumit884-byte', 'css-samosa-kitchen'],
  },
  {
    role: 'ai engineer',
    include: ['arka', 'summarize_pdfs', 'stock_analyzer', 'Syntropy'],
    exclude: ['Sumit884-byte', 'gmail_notifier', 'css-samosa-kitchen', 'linkedin_connection_bot'],
  },
  {
    role: 'frontend engineer',
    include: ['rsume-site', 'threejs_demo', 'css-samosa-kitchen'],
    exclude: ['gmail_notifier', 'stock_analyzer', 'linkedin_connection_bot', 'arka'],
  },
  {
    role: 'data scientist',
    include: ['stock_analyzer'],
    exclude: ['rsume-site', 'gmail_notifier', 'css-samosa-kitchen', 'Sumit884-byte'],
  },
  {
    role: 'product designer',
    include: ['rsume-site', 'css-samosa-kitchen'],
    exclude: ['gmail_notifier', 'stock_analyzer', 'linkedin_connection_bot', 'Sumit884-byte'],
  },
  {
    role: 'full stack engineer',
    include: ['rsume-site', 'threejs_demo'],
    exclude: ['Sumit884-byte', 'gmail_notifier'],
  },
  {
    role: 'mobile developer',
    include: [],
    exclude: ['gmail_notifier', 'stock_analyzer', 'css-samosa-kitchen'],
  },
  {
    role: 'backend engineer',
    include: [],
    exclude: ['css-samosa-kitchen', 'tasty_noodles', 'rsume-site'],
  },
]

test('role resumes stay on the work that fits', async () => {
  delete process.env.LLM_BASE_URL
  for (const spec of cases) {
    const resume = await resumeFor(spec.role)
    const titles = (resume.work || []).map((item) => item.title)
    assert.ok(titles.length <= 8, `${spec.role} kept ${titles.length}`)
    assert.ok(titles.length < projects.length, `${spec.role} kept every project`)
    for (const name of spec.include) assert.ok(titles.includes(name), `${spec.role} left out ${name}: ${titles.join(', ')}`)
    for (const name of spec.exclude) assert.ok(!titles.includes(name), `${spec.role} included ${name}`)
    assert.doesNotMatch(resume.summary || '', /leave out/)
  }
  assert.deepEqual(namesFromDescriptions(projects, 'ai developer').includes('gmail_notifier'), false)
})
