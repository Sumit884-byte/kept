import PDFDocument from 'pdfkit'
import { copy } from './copy.js'
import { starLabel } from './resume.js'

export function pdfText(value) {
  return String(value ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2022/g, '-')
    .replace(/[^\t\n\r\x20-\x7E\u00A0-\u00FF]/g, '')
}

function ensure(doc, height) {
  const limit = doc.page.height - doc.page.margins.bottom
  if (doc.y + height > limit) doc.addPage()
}

export function renderPdf(resume) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 54, bottom: 56, left: 58, right: 58 },
      info: {
        Title: `${pdfText(resume.name)} resume`,
        Author: pdfText(resume.name),
      },
    })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    draw(doc, resume)
    doc.end()
  })
}

function draw(doc, resume) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const left = doc.page.margins.left
  if (resume.example) {
    doc.font('Times-Bold').fontSize(9).fillColor('#1f6a4a').text(pdfText(copy.pdf.example), left, 36)
  }
  doc.fillColor('#211e19').font('Times-Bold').fontSize(resume.name.length > 28 ? 16 : 22)
  doc.text(pdfText(resume.name), left, resume.example ? 52 : 54, { width })
  if (resume.contact?.length) {
    doc.moveDown(0.25)
    doc.font('Times-Roman').fontSize(10).fillColor('#5c564c')
    doc.text(pdfText(resume.contact.join('  ·  ')), { width })
  }
  doc.moveDown(0.4)
  const ruleY = doc.y
  doc.strokeColor('#d9d1c5').lineWidth(1).moveTo(left, ruleY).lineTo(left + width, ruleY).stroke()
  doc.moveDown(0.7)
  if (resume.headline) {
    doc.font('Times-Italic').fontSize(12).fillColor('#1f6a4a')
    doc.text(pdfText(resume.headline), { width })
    doc.moveDown(0.45)
  }
  if (resume.summary) {
    doc.font('Times-Roman').fontSize(11).fillColor('#211e19')
    doc.text(pdfText(resume.summary), { width, lineGap: 2 })
    doc.moveDown(0.8)
  }
  if (resume.education?.length) {
    ensure(doc, 36)
    doc.font('Times-Bold').fontSize(11).fillColor('#211e19').text(pdfText(copy.pdf.education), { width })
    doc.moveDown(0.3)
    for (const line of resume.education) {
      ensure(doc, 24)
      doc.font('Times-Roman').fontSize(11).text(pdfText(line), { width })
      doc.moveDown(0.15)
    }
    doc.moveDown(0.45)
  }
  if (resume.skills?.length) {
    ensure(doc, 36)
    doc.font('Times-Bold').fontSize(11).fillColor('#211e19').text(pdfText(copy.pdf.skills), { width })
    doc.moveDown(0.3)
    doc.font('Times-Roman').fontSize(11).text(pdfText(resume.skills.join(', ')), { width })
    doc.moveDown(0.7)
  }
  if (resume.work?.length) {
    ensure(doc, 40)
    doc.font('Times-Bold').fontSize(11).fillColor('#211e19').text(pdfText(copy.pdf.selectedWork), { width, characterSpacing: 0.6 })
    doc.moveDown(0.45)
    for (const item of resume.work) {
      ensure(doc, 48)
      doc.font('Times-Bold').fontSize(12).fillColor('#211e19').text(pdfText(item.stars > 0 ? `${item.title}  ${starLabel(item.stars)}` : item.title), { width })
      if (item.url) {
        doc.font('Times-Roman').fontSize(9).fillColor('#5c564c').text(pdfText(item.url), { width })
      }
      doc.moveDown(0.2)
      for (const line of item.lines || []) {
        ensure(doc, 28)
        doc.font('Times-Roman').fontSize(10.5).fillColor('#211e19')
        doc.text(pdfText(`-  ${line}`), left + 8, doc.y, { width: width - 8, lineGap: 1 })
        doc.moveDown(0.15)
      }
      doc.moveDown(0.45)
    }
  }
  if (resume.contributions?.length) {
    ensure(doc, 36)
    doc.font('Times-Bold').fontSize(11).fillColor('#211e19').text(pdfText(copy.pdf.contributions), { width })
    doc.moveDown(0.35)
    for (const item of resume.contributions) {
      ensure(doc, 36)
      doc.font('Times-Bold').fontSize(12).fillColor('#211e19').text(pdfText(item.title || ''), { width })
      if (item.url) doc.font('Times-Roman').fontSize(9).fillColor('#5c564c').text(pdfText(item.url), { width })
      doc.moveDown(0.15)
      doc.font('Times-Roman').fontSize(10.5).fillColor('#211e19').text(pdfText(`-  ${item.line}`), left + 8, doc.y, { width: width - 8 })
      doc.moveDown(0.4)
    }
  }
  if (resume.liveUrl) {
    doc.font('Times-Roman').fontSize(8).fillColor('#8a8378')
    doc.text(pdfText(resume.liveUrl), left, doc.page.height - doc.page.margins.bottom + 16, { width, lineBreak: false })
  }
}

export function fileName(name) {
  const base = pdfText(name).trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9.-]/g, '') || 'resume'
  return `${base}.pdf`
}
