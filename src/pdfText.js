export function pdfText(value) {
  return String(value ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2022/g, '-')
    .replace(/[^\t\n\r\x20-\x7E\u00A0-\u00FF]/g, '')
}

export function fileName(name) {
  const base = pdfText(name).trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9.-]/g, '') || 'resume'
  return `${base}.pdf`
}
