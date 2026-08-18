import { test, expect } from 'bun:test'
import { ServiceError } from '../src/util/errors.js'
import {
  doc, paragraph, text, heading, bulletList, codeBlock, blockquote,
  hardBreak, horizontalRule, callout, historianRef, documentRef, actionRow,
  pmDocToText, validateMessageKind,
} from '../src/core/pmDoc.js'

// ── pmDocToText ───────────────────────────────────────────────────────────────

test('pmDocToText extracts plain text from a simple paragraph', () => {
  const d = doc(paragraph(text('Hello world')))
  expect(pmDocToText(d)).toBe('Hello world')
})

test('pmDocToText joins multiple paragraphs with newlines', () => {
  const d = doc(paragraph(text('First')), paragraph(text('Second')))
  expect(pmDocToText(d)).toContain('First')
  expect(pmDocToText(d)).toContain('Second')
})

test('pmDocToText handles hard_break', () => {
  const d = doc(paragraph(text('line one'), hardBreak(), text('line two')))
  expect(pmDocToText(d)).toContain('line one')
  expect(pmDocToText(d)).toContain('line two')
})

test('pmDocToText extracts text from a decision_callout', () => {
  const d = doc(callout('decision', 'Cut over to live'))
  expect(pmDocToText(d)).toContain('Cut over to live')
})

test('pmDocToText extracts historian_ref as readable string', () => {
  const d = doc(historianRef({ repo: 'kaizen/mesh', commit: 'a3f9c1e', confirmed_by: ['Joey', 'Maya'] }))
  expect(pmDocToText(d)).toContain('a3f9c1e')
  expect(pmDocToText(d)).toContain('kaizen/mesh')
  expect(pmDocToText(d)).toContain('Joey')
})

test('pmDocToText extracts document_ref title', () => {
  const d = doc(documentRef({ doc_id: 'd1', path: 'docs/decisions.md', title: 'Decisions' }))
  expect(pmDocToText(d)).toContain('Decisions')
})

test('pmDocToText extracts action button labels', () => {
  const d = doc(actionRow([{ label: 'Confirm', value: 'confirm' }, { label: 'Reject', value: 'reject' }]))
  expect(pmDocToText(d)).toContain('Confirm')
  expect(pmDocToText(d)).toContain('Reject')
})

test('pmDocToText returns empty string for null input', () => {
  expect(pmDocToText(null)).toBe('')
  expect(pmDocToText(undefined)).toBe('')
})

// ── validateMessageKind ───────────────────────────────────────────────────────

test('validateMessageKind accepts kind=text with no content_json', () => {
  expect(() => validateMessageKind({ kind: 'text', text: 'hi' })).not.toThrow()
  expect(validateMessageKind({ kind: 'text', text: 'hi' })).toBeNull()
})

test('validateMessageKind rejects unknown kind', () => {
  expect(() => validateMessageKind({ kind: 'html', text: 'hi' })).toThrow(ServiceError)
})

test('validateMessageKind rejects kind=pm with no content_json', () => {
  expect(() => validateMessageKind({ kind: 'pm', text: 'fallback' })).toThrow(ServiceError)
})

test('validateMessageKind rejects kind=pm with invalid JSON in content_json', () => {
  expect(() => validateMessageKind({ kind: 'pm', content_json: 'not json', text: 'fallback' })).toThrow(ServiceError)
})

test('validateMessageKind rejects kind=pm when content_json is not a doc node', () => {
  const bad = JSON.stringify({ type: 'paragraph', content: [] })
  expect(() => validateMessageKind({ kind: 'pm', content_json: bad, text: 'fallback' })).toThrow(ServiceError)
})

test('validateMessageKind rejects kind=pm with no text fallback', () => {
  const good = JSON.stringify(doc(paragraph(text('hi'))))
  expect(() => validateMessageKind({ kind: 'pm', content_json: good, text: '  ' })).toThrow(ServiceError)
})

test('validateMessageKind accepts valid kind=pm message and returns parsed doc', () => {
  const pmDoc = doc(paragraph(text('hello')))
  const content_json = JSON.stringify(pmDoc)
  const result = validateMessageKind({ kind: 'pm', content_json, text: 'hello' })
  expect(result).toMatchObject({ type: 'doc' })
})

// ── node builders ─────────────────────────────────────────────────────────────

test('callout builds a node with correct type and file_ref attr', () => {
  const node = callout('decision', 'Buy vs build', { file_ref: 'docs/decisions.md' })
  expect(node.type).toBe('decision_callout')
  expect(node.attrs.file_ref).toBe('docs/decisions.md')
  expect(node.content[0].text).toBe('Buy vs build')
})

test('historianRef builds a node with repo, commit, confirmed_by attrs', () => {
  const node = historianRef({ repo: 'kaizen/mesh', commit: 'abc123', confirmed_by: ['Alice', 'Bob'] })
  expect(node.type).toBe('historian_ref')
  expect(node.attrs.confirmed_by).toBe('Alice, Bob')
})

test('actionRow builds action_button children with label and value attrs', () => {
  const row = actionRow([{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }])
  expect(row.type).toBe('action_row')
  expect(row.content).toHaveLength(2)
  expect(row.content[0].attrs).toMatchObject({ label: 'Yes', value: 'yes' })
})

test('text node with marks includes marks array', () => {
  const node = text('bold', ['bold'])
  expect(node.marks).toEqual([{ type: 'bold' }])
})
