/** Letter page usable height (pt), aligned with src/pdf.js margins. */
export const PDF_PAGE = {
  width: 612,
  height: 792,
  marginTop: 54,
  marginBottom: 56,
  marginLeft: 60,
  marginRight: 60,
}

export function pdfBodyBottom(page = PDF_PAGE) {
  return page.height - page.marginBottom
}

export function pdfContentWidth(page = PDF_PAGE) {
  return page.width - page.marginLeft - page.marginRight
}

/** Rough page count from rendered PDF bytes (for tests and tuning). */
export function countPdfPages(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '')
  const matches = text.match(/\/Type\s*\/Page\b/g)
  return matches ? matches.length : 0
}
