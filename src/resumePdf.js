import './pdfFontTrace.js'
import { renderToBuffer } from '@react-pdf/renderer'
import { classicResumeDocument, TEMPLATE_ID } from './resumeTemplateClassic.js'

export { TEMPLATE_ID }

export async function renderPdf(resume) {
  return renderToBuffer(classicResumeDocument(resume))
}
