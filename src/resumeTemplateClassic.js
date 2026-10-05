/**
 * Classic single-column resume layout (ATS-friendly, calm typography).
 * Used by @react-pdf/renderer for all exported PDFs.
 */
import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { copy } from './copy.js'
import { displayProjectTitle, introForPdf } from './display.js'
import { pdfText } from './pdfText.js'
import { starLabel } from './resume.js'

export const TEMPLATE_ID = 'classic'

const C = {
  accent: '#1f6a4a',
  ink: '#1a1816',
  body: '#3d3832',
  muted: '#6b645a',
  faint: '#928a7e',
  paper: '#fffdf8',
  headerBg: '#f7f4ee',
  rule: '#ddd5c8',
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: C.paper,
    fontFamily: 'Helvetica',
    fontSize: 10.25,
    color: C.body,
    lineHeight: 1.45,
  },
  headerBand: {
    backgroundColor: C.headerBg,
    borderTopWidth: 4,
    borderTopColor: C.accent,
    paddingTop: 22,
    paddingBottom: 16,
    paddingHorizontal: 62,
  },
  eyebrow: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.muted,
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  name: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: C.ink,
    lineHeight: 1.12,
    marginBottom: 8,
  },
  nameLong: {
    fontSize: 19,
    fontFamily: 'Helvetica-Bold',
    color: C.ink,
    lineHeight: 1.12,
    marginBottom: 8,
  },
  contact: {
    fontSize: 9,
    color: C.muted,
    lineHeight: 1.35,
  },
  body: {
    paddingHorizontal: 62,
    paddingTop: 14,
    paddingBottom: 52,
  },
  intro: {
    borderLeftWidth: 2,
    borderLeftColor: C.accent,
    paddingLeft: 10,
    marginBottom: 8,
  },
  introHeadline: {
    fontSize: 10.75,
    fontFamily: 'Helvetica-Oblique',
    color: C.body,
    marginBottom: 4,
  },
  introSummary: {
    fontSize: 10.5,
    color: C.body,
    lineHeight: 1.48,
  },
  section: {
    marginTop: 13,
  },
  sectionFirst: {
    marginTop: 6,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionMark: {
    width: 3,
    height: 11,
    backgroundColor: C.accent,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: C.accent,
    letterSpacing: 1.2,
  },
  bodyLine: {
    fontSize: 10.25,
    color: C.ink,
    marginBottom: 3,
  },
  skills: {
    fontSize: 10,
    color: C.body,
    lineHeight: 1.48,
  },
  project: {
    marginTop: 7,
  },
  projectFirst: {
    marginTop: 0,
  },
  projectTitleLine: {
    lineHeight: 1.2,
    marginBottom: 2,
  },
  projectTitle: {
    fontSize: 11.25,
    fontFamily: 'Helvetica-Bold',
    color: C.ink,
  },
  projectStars: {
    fontSize: 9,
    color: C.muted,
  },
  projectUrl: {
    fontSize: 7.75,
    color: C.faint,
    marginBottom: 3,
  },
  bulletLine: {
    marginBottom: 3,
    paddingRight: 6,
    lineHeight: 1.45,
  },
  bulletMark: {
    fontSize: 10.25,
    color: C.accent,
  },
  bulletText: {
    fontSize: 10.25,
    color: C.body,
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 62,
    right: 62,
    fontSize: 7.25,
    color: C.faint,
    textAlign: 'center',
  },
})

function Section({ title, first, children }) {
  return React.createElement(
    View,
    { style: first ? styles.sectionFirst : styles.section },
    React.createElement(
      View,
      { style: styles.sectionHead },
      React.createElement(View, { style: styles.sectionMark }),
      React.createElement(Text, { style: styles.sectionTitle }, pdfText(String(title || '').toUpperCase())),
    ),
    children,
  )
}

function Bullets({ lines }) {
  const items = (lines || []).slice(0, 3).map((line) => pdfText(line)).filter(Boolean)
  return React.createElement(
    View,
    null,
    items.map((line, index) => React.createElement(
      Text,
      { key: `b-${index}`, style: styles.bulletLine },
      React.createElement(Text, { style: styles.bulletMark }, '\u2022  '),
      React.createElement(Text, { style: styles.bulletText }, line),
    )),
  )
}

function Project({ item, first }) {
  const title = displayProjectTitle(item.title)
  const stars = Number(item.stars) || 0
  return React.createElement(
    View,
    { style: first ? styles.projectFirst : styles.project },
    React.createElement(
      Text,
      { style: styles.projectTitleLine },
      React.createElement(Text, { style: styles.projectTitle }, pdfText(title)),
      stars > 0
        ? React.createElement(Text, { style: styles.projectStars }, pdfText(`   ${starLabel(stars)}`))
        : null,
    ),
    item.url ? React.createElement(Text, { style: styles.projectUrl }, pdfText(item.url)) : null,
    Bullets({ lines: item.lines }),
  )
}

export function ClassicResumePage({ resume }) {
  const intro = introForPdf(resume)
  const nameStyle = (resume.name || '').length > 26 ? styles.nameLong : styles.name
  let sectionIndex = 0
  const nextFirst = () => {
    const first = sectionIndex === 0
    sectionIndex += 1
    return first
  }

  return React.createElement(
    Page,
    { size: 'LETTER', style: styles.page },
    React.createElement(
      View,
      { style: styles.headerBand },
      resume.example
        ? React.createElement(Text, { style: styles.eyebrow }, pdfText(String(copy.pdf.example).toUpperCase()))
        : null,
      React.createElement(Text, { style: nameStyle }, pdfText(resume.name || 'Resume')),
      (resume.contact || []).length
        ? React.createElement(Text, { style: styles.contact }, pdfText(resume.contact.join('  ·  ')))
        : null,
    ),
    React.createElement(
      View,
      { style: styles.body },
      (intro.headline || intro.summary)
        ? React.createElement(
          View,
          { style: styles.intro },
          intro.headline
            ? React.createElement(Text, { style: styles.introHeadline }, pdfText(intro.headline))
            : null,
          intro.summary
            ? React.createElement(Text, { style: styles.introSummary }, pdfText(intro.summary))
            : null,
        )
        : null,
      (resume.experience || []).length
        ? React.createElement(
          Section,
          { title: copy.pdf.experience, first: nextFirst() },
          (resume.experience || []).map((line, index) => React.createElement(
            Text,
            { key: `exp-${index}`, style: styles.bodyLine },
            pdfText(line),
          )),
        )
        : null,
      (resume.education || []).length
        ? React.createElement(
          Section,
          { title: copy.pdf.education, first: nextFirst() },
          (resume.education || []).map((line, index) => React.createElement(
            Text,
            { key: `edu-${index}`, style: styles.bodyLine },
            pdfText(line),
          )),
        )
        : null,
      (resume.skills || []).length
        ? React.createElement(
          Section,
          { title: copy.pdf.skills, first: nextFirst() },
          React.createElement(Text, { style: styles.skills }, pdfText(resume.skills.join(', '))),
        )
        : null,
      (resume.work || []).length
        ? React.createElement(
          Section,
          { title: copy.pdf.selectedWork, first: nextFirst() },
          (resume.work || []).map((item, index) => React.createElement(Project, {
            key: `work-${index}`,
            item,
            first: index === 0,
          })),
        )
        : null,
      (resume.contributions || []).length
        ? React.createElement(
          Section,
          { title: copy.pdf.contributions, first: nextFirst() },
          (resume.contributions || []).map((item, index) => React.createElement(Project, {
            key: `contrib-${index}`,
            first: index === 0,
            item: { title: item.title, url: item.url, stars: 0, lines: [item.line] },
          })),
        )
        : null,
    ),
    resume.liveUrl
      ? React.createElement(Text, { style: styles.footer, fixed: true }, pdfText(resume.liveUrl))
      : null,
  )
}

export function classicResumeDocument(resume) {
  return React.createElement(
    Document,
    {
      title: `${pdfText(resume.name)} resume`,
      author: pdfText(resume.name),
    },
    React.createElement(ClassicResumePage, { resume }),
  )
}
