/** US Letter aspect ratio (height / width), matching PDF output. */
const LETTER = 11 / 8.5

function isSectionHeading(block) {
  return block.tagName === 'H2' && !block.classList.contains('paper-name')
}

function sectionGroups(blocks) {
  const groups = []
  let current = []
  for (const block of blocks) {
    if (isSectionHeading(block) && current.length) {
      groups.push(current)
      current = [block]
    } else {
      current.push(block)
    }
  }
  if (current.length) groups.push(current)
  return groups
}

function flattenGroups(groups) {
  return groups.flat()
}

function createMeasureHost(article, width) {
  const measureHost = document.createElement('div')
  measureHost.setAttribute('aria-hidden', 'true')
  measureHost.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden'
  const measurePaper = document.createElement('article')
  measurePaper.className = article.className
  measurePaper.style.width = `${width}px`
  measureHost.appendChild(measurePaper)
  document.body.appendChild(measureHost)
  return { measureHost, measurePaper }
}

function measureClassicSheet(measurePaper, article, nodes, { first }) {
  measurePaper.className = `${article.className} paper-sheet${first ? '' : ' paper-sheet-continued'}`
  measurePaper.replaceChildren()
  const header = article.querySelector(':scope > .paper-header-band')
  if (first && header) measurePaper.appendChild(header.cloneNode(true))
  const bodyWrap = document.createElement('div')
  bodyWrap.className = 'paper-body'
  nodes.forEach((node) => bodyWrap.appendChild(node.cloneNode(true)))
  measurePaper.appendChild(bodyWrap)
  return measurePaper.offsetHeight
}

function measureLegacySheet(measurePaper, nodes) {
  measurePaper.replaceChildren(...nodes.map((node) => node.cloneNode(true)))
  return measurePaper.offsetHeight
}

function paginateGroups(groups, article, width, padY, { classic }) {
  const pageInner = Math.max(120, width * LETTER - padY)
  const { measureHost, measurePaper } = createMeasureHost(article, width)
  const pages = []
  let pageGroups = []

  for (const group of groups) {
    const trial = [...pageGroups, group]
    const flat = flattenGroups(trial).map((node) => node.cloneNode(true))
    const onFirstSheet = pages.length === 0
    const height = classic
      ? measureClassicSheet(measurePaper, article, flat, { first: onFirstSheet })
      : measureLegacySheet(measurePaper, flat)

    if (height > pageInner && pageGroups.length > 0) {
      pages.push(pageGroups)
      pageGroups = [group]
    } else {
      pageGroups = trial
    }
  }
  if (pageGroups.length) pages.push(pageGroups)
  measureHost.remove()
  return pages
}

function buildClassicSheet(article, sheetGroups, { first }) {
  const sheet = document.createElement('article')
  sheet.className = `${article.className} paper-sheet${first ? '' : ' paper-sheet-continued'}`
  const header = article.querySelector(':scope > .paper-header-band')
  if (first && header) sheet.appendChild(header.cloneNode(true))
  const bodyWrap = document.createElement('div')
  bodyWrap.className = 'paper-body'
  flattenGroups(sheetGroups).forEach((node) => bodyWrap.appendChild(node.cloneNode(true)))
  sheet.appendChild(bodyWrap)
  return sheet
}

function buildLegacySheet(article, sheetGroups) {
  const sheet = document.createElement('article')
  sheet.className = `${article.className} paper-sheet`
  flattenGroups(sheetGroups).forEach((node) => sheet.appendChild(node.cloneNode(true)))
  return sheet
}

/**
 * Split one .paper article into stacked letter-sized sheets from measured block heights.
 */
export function layoutPaperPages(slot) {
  if (!slot) return
  if (slot.closest('.hero-stage')) return
  const article = slot.querySelector(':scope > .paper')
  if (!article) return

  const width = slot.clientWidth
  if (width < 40) return

  const isClassic = article.classList.contains('paper-classic')
  const bodyEl = isClassic ? article.querySelector(':scope > .paper-body') : null
  const blocks = bodyEl ? [...bodyEl.children] : [...article.children]
  if (!blocks.length) return

  const groups = sectionGroups(blocks)
  const styles = getComputedStyle(article)
  const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
  const pages = paginateGroups(groups, article, width, padY, { classic: isClassic })

  const stack = document.createElement('div')
  stack.className = 'paper-stack'
  pages.forEach((sheetGroups, index) => {
    const sheet = isClassic
      ? buildClassicSheet(article, sheetGroups, { first: index === 0 })
      : buildLegacySheet(article, sheetGroups)
    stack.appendChild(sheet)
  })
  slot.replaceChildren(stack)
}

export function schedulePaperLayout(root = document) {
  requestAnimationFrame(() => {
    root.querySelectorAll('[data-paper-root]').forEach((slot) => layoutPaperPages(slot))
  })
}
