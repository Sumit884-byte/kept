function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString()
}

const parcelSource = `
const express = require('express')
const app = express()

app.get('/drafts', (req, res) => res.send('drafts'))
app.post('/send', (req, res) => res.send('sent'))
app.post('/reminders', (req, res) => res.send('reminded'))

app.listen(3000)
`

export const sampleProjects = [
  {
    fullName: 'northwind/ledger',
    earlier: { stars: 12, forks: 2, openIssues: 11 },
    list: {
      fullName: 'northwind/ledger',
      name: 'Ledger',
      description: 'Invoices and payment records for small shops.',
      private: false,
      language: 'TypeScript',
      pushedAt: daysAgo(2),
    },
    gather: {
      repo: {
        full_name: 'northwind/ledger',
        name: 'Ledger',
        description: 'Invoices and payment records for small shops.',
        private: false,
        language: 'TypeScript',
        url: 'https://github.com/northwind/ledger',
        stars: 40,
        forks: 9,
        openIssues: 4,
        watchers: 6,
        pushedAt: daysAgo(2),
      },
      readme: `# Ledger

Ledger helps small shops send invoices and keep a record of what was paid.

Used by 120 shops.
`,
      files: [],
      commits: [
        { message: 'Shape the product around invoices for small shops', date: daysAgo(4), additions: 80, deletions: 10 },
        { message: 'Send reminders before invoices are late', date: daysAgo(10), additions: 200, deletions: 40 },
      ],
      releases: [{ name: 'v1.4', publishedAt: daysAgo(12) }],
      window: { additions: 1400, deletions: 600, commits: 28, complete: true },
    },
  },
  {
    fullName: 'northwind/parcel',
    earlier: null,
    list: {
      fullName: 'northwind/parcel',
      name: 'Parcel',
      description: '',
      private: true,
      language: 'JavaScript',
      pushedAt: daysAgo(6),
    },
    gather: {
      repo: {
        full_name: 'northwind/parcel',
        name: 'Parcel',
        description: '',
        private: true,
        language: 'JavaScript',
        url: 'https://github.com/northwind/parcel',
        stars: 3,
        forks: 0,
        openIssues: 1,
        watchers: 0,
        pushedAt: daysAgo(6),
      },
      readme: '# Parcel\n\nTODO\n',
      files: [
        {
          path: 'package.json',
          text: JSON.stringify({
            name: 'parcel',
            description: '',
            dependencies: { express: '^4.19.0' },
            bin: { 'parcel-run': './bin.js' },
          }),
        },
        { path: 'src/index.js', text: parcelSource },
      ],
      commits: [
        { message: 'Add weekly reminders for unpaid invoices', date: daysAgo(8), additions: 400, deletions: 20 },
        { message: 'Simplify the draft page', date: daysAgo(20), additions: 120, deletions: 80 },
      ],
      releases: [],
      window: { additions: 820, deletions: 140, commits: 15, complete: true },
    },
  },
]

export const samplePerson = {
  name: 'Mira Chen',
  email: 'mira@example.com',
  location: 'Lisbon',
  blog: '',
  login: 'mira',
  bio: 'Product engineer who likes calm tools.',
  headline: 'Product engineer',
  profileReadme: 'Product engineer using TypeScript and JavaScript for tools that shops can trust.',
  education: 'Lisbon University, product engineering',
  pulls: [
    {
      title: 'Add a product checklist for invoice reminders',
      where: 'shops/ledger',
      url: 'github.com/shops/ledger/pull/12',
      text: 'A product checklist so small shops notice unpaid invoices.',
    },
  ],
}

export function findSample(fullName) {
  return sampleProjects.find((project) => project.fullName === fullName) || null
}

export function listSampleProjects() {
  return sampleProjects.map((project) => project.list)
}
