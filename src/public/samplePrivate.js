const parcelSource = `
const express = require('express')
const app = express()

app.get('/drafts', (req, res) => res.send('drafts'))
app.post('/send', (req, res) => res.send('sent'))
app.post('/reminders', (req, res) => res.send('reminded'))

app.listen(3000)
`

export const samplePrivate = {
  'northwind/parcel': [
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
}
