import './pdfFontTrace.js'
import { renderToBuffer } from '@react-pdf/renderer'
import { classicResumeDocument, TEMPLATE_ID } from './resumeTemplateClassic.js'
import { plainResumeDocument } from './resumeTemplatePlain.js'
import { templateId } from './templates.js'

export { TEMPLATE_ID }

const DOCUMENTS = {
  classic: classicResumeDocument,
  plain: plainResumeDocument,
}

export async function renderPdf(resume) {
  return renderToBuffer(DOCUMENTS[templateId(resume?.template)](resume))
}
