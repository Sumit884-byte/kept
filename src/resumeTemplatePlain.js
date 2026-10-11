/**
 * Plain single-column resume layout: black on white, a serif face, thin rules.
 * It carries the same outline as the classic layout and prints without colour.
 */
import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { resumeOutline } from './resumeOutline.js'
import { pdfText } from './pdfText.js'

export const TEMPLATE_ID = 'plain'

const C = {
  ink: '#111111',
  body: '#222222',
  muted: '#555555',
  rule: '#8a8a8a',
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    fontFamily: 'Times-Roman',
    fontSize: 10.75,
    color: C.body,
    lineHeight: 1.38,
    paddingTop: 44,
    paddingBottom: 52,
    paddingHorizontal: 58,
  },
  eyebrow: {
    fontSize: 7.5,
    fontFamily: 'Times-Bold',
    color: C.muted,
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 6,
  },
  name: {
    fontSize: 22,
    fontFamily: 'Times-Bold',
    color: C.ink,
    lineHeight: 1.12,
    textAlign: 'center',
  },
  nameLong: {
    fontSize: 18,
    fontFamily: 'Times-Bold',
    color: C.ink,
    lineHeight: 1.12,
    textAlign: 'center',
  },
  contact: {
    fontSize: 9.5,
    color: C.muted,
    textAlign: 'center',
    marginTop: 5,
  },
  headRule: {
    borderBottomWidth: 1,
    borderBottomColor: C.ink,
    marginTop: 9,
    marginBottom: 9,
  },
  introHeadline: {
    fontFamily: 'Times-Italic',
    fontSize: 11,
    color: C.body,
    marginBottom: 3,
  },
  introSummary: {
    fontSize: 10.75,
    color: C.body,
  },
  section: {
    marginTop: 11,
  },
  sectionFirst: {
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 9.5,
    fontFamily: 'Times-Bold',
    color: C.ink,
    letterSpacing: 1.1,
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
    paddingBottom: 2,
    marginBottom: 5,
  },
  bodyLine: {
    color: C.ink,
    marginBottom: 2,
  },
  skills: {
    color: C.body,
  },
  project: {
    marginTop: 6,
  },
  projectFirst: {
    marginTop: 0,
  },
  projectTitleLine: {
    lineHeight: 1.2,
    marginBottom: 1,
  },
  projectTitle: {
    fontSize: 11.25,
    fontFamily: 'Times-Bold',
    color: C.ink,
  },
  projectStars: {
    fontSize: 9.5,
    fontFamily: 'Times-Italic',
    color: C.muted,
  },
  projectUrl: {
    fontSize: 8.5,
    color: C.muted,
    marginBottom: 2,
  },
  bulletLine: {
    marginBottom: 2,
    paddingLeft: 9,
    paddingRight: 6,
  },
  footer: {
    position: 'absolute',
    bottom: 26,
    left: 58,
    right: 58,
    fontSize: 7.5,
    color: C.muted,
    textAlign: 'center',
  },
})

function Section({ title, first, children }) {
  const [lead, ...rest] = React.Children.toArray(children)
  return React.createElement(
    View,
    { style: first ? styles.sectionFirst : styles.section },
    // The heading and its first entry move to the next page together, so a heading is never left alone.
    React.createElement(
      View,
      { wrap: false },
      React.createElement(Text, { style: styles.sectionTitle }, pdfText(String(title || '').toUpperCase())),
      lead,
    ),
    ...rest,
  )
}

function Project({ item, first }) {
  const lines = (item.lines || []).map((line) => pdfText(line)).filter(Boolean)
  return React.createElement(
    View,
    { style: first ? styles.projectFirst : styles.project, wrap: false },
    React.createElement(
      Text,
      { style: styles.projectTitleLine },
      React.createElement(Text, { style: styles.projectTitle }, pdfText(item.title)),
      item.stars
        ? React.createElement(Text, { style: styles.projectStars }, pdfText(`   ${item.stars}`))
        : null,
    ),
    item.url ? React.createElement(Text, { style: styles.projectUrl }, pdfText(item.url)) : null,
    lines.map((line, index) => React.createElement(
      Text,
      { key: `b-${index}`, style: styles.bulletLine },
      `-  ${line}`,
    )),
  )
}

function sectionNodes(section) {
  if (section.kind === 'lines') {
    return section.lines.map((line, index) => React.createElement(
      Text,
      { key: `line-${index}`, style: styles.bodyLine },
      pdfText(line),
    ))
  }
  if (section.kind === 'skills') {
    return React.createElement(Text, { style: styles.skills }, pdfText(section.text))
  }
  return section.projects.map((item, index) => React.createElement(Project, {
    key: `project-${index}`,
    item,
    first: index === 0,
  }))
}

export function PlainResumePage({ resume }) {
  const doc = resumeOutline(resume) || { name: '', contact: [], sections: [] }
  return React.createElement(
    Page,
    { size: 'LETTER', style: styles.page },
    doc.example
      ? React.createElement(Text, { style: styles.eyebrow }, pdfText(String(doc.exampleLabel || '').toUpperCase()))
      : null,
    React.createElement(Text, { style: doc.name.length > 30 ? styles.nameLong : styles.name }, pdfText(doc.name || 'Resume')),
    doc.contact.length
      ? React.createElement(Text, { style: styles.contact }, pdfText(doc.contact.join('  |  ')))
      : null,
    React.createElement(View, { style: styles.headRule }),
    doc.headline
      ? React.createElement(Text, { style: styles.introHeadline }, pdfText(doc.headline))
      : null,
    doc.summary
      ? React.createElement(Text, { style: styles.introSummary }, pdfText(doc.summary))
      : null,
    ...doc.sections.map((section, index) => React.createElement(
      Section,
      { key: `section-${index}`, title: section.title, first: section.first && !doc.headline && !doc.summary },
      sectionNodes(section),
    )),
    doc.liveUrl
      ? React.createElement(Text, { style: styles.footer, fixed: true }, pdfText(doc.liveUrl))
      : null,
  )
}

export function plainResumeDocument(resume) {
  return React.createElement(
    Document,
    {
      title: `${pdfText(resume.name)} resume`,
      author: pdfText(resume.name),
    },
    React.createElement(PlainResumePage, { resume }),
  )
}
