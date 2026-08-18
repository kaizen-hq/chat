import { ServiceError } from '../util/errors.js'

// ── Node builders ─────────────────────────────────────────────────────────────

export function text(str, marks = []) {
  const node = { type: 'text', text: str }
  if (marks.length) node.marks = marks.map(m => typeof m === 'string' ? { type: m } : m)
  return node
}

export function paragraph(...children) {
  return { type: 'paragraph', content: children }
}

export function heading(level, ...children) {
  return { type: 'heading', attrs: { level }, content: children }
}

export function bulletList(...items) {
  return { type: 'bullet_list', content: items.map(content => ({ type: 'list_item', content: [paragraph(...(Array.isArray(content) ? content : [content]))] })) }
}

export function codeBlock(code) {
  return { type: 'code_block', content: [{ type: 'text', text: code }] }
}

export function blockquote(...children) {
  return { type: 'blockquote', content: children }
}

export function horizontalRule() {
  return { type: 'horizontal_rule' }
}

export function hardBreak() {
  return { type: 'hard_break' }
}

/**
 * Callout card for decisions, architecture notes, etc.
 * @param {'decision'|'architecture'|string} type
 * @param {string} body  – plain text summary shown in the card
 * @param {{ file_ref?: string }} [attrs]
 */
export function callout(type, body, attrs = {}) {
  return {
    type: `${type}_callout`,
    attrs: { file_ref: attrs.file_ref ?? null },
    content: [{ type: 'text', text: body }],
  }
}

/**
 * Historian git-commit timeline entry posted after a successful mesh commit.
 * @param {{ repo: string, commit: string, confirmed_by?: string[] }} opts
 */
export function historianRef({ repo, commit, confirmed_by = [] }) {
  return {
    type: 'historian_ref',
    attrs: { repo, commit, confirmed_by: confirmed_by.join(', ') },
  }
}

/**
 * Link card to a pinned document.
 * @param {{ doc_id: string, path: string, title: string, commit?: string }} opts
 */
export function documentRef({ doc_id, path, title, commit = null }) {
  return { type: 'document_ref', attrs: { doc_id, path, title, commit } }
}

/**
 * A row of action buttons. Clicking a button sends msg.send with reply_to=<card msg_id>
 * and body.value=<button value>.
 * @param {Array<{ label: string, value: string }>} buttons
 */
export function actionRow(buttons) {
  return {
    type: 'action_row',
    content: buttons.map(b => ({ type: 'action_button', attrs: { label: b.label, value: b.value } })),
  }
}

/**
 * Wrap an array of block nodes in a PM doc root.
 */
export function doc(...blocks) {
  return { type: 'doc', content: blocks }
}

// ── Text extraction ───────────────────────────────────────────────────────────

/**
 * Extract a plain-text representation from a PM doc for FTS indexing and
 * push notification previews. Never throws.
 */
export function pmDocToText(pmDoc) {
  if (!pmDoc || typeof pmDoc !== 'object') return ''
  return extractText(pmDoc).trim()
}

function extractText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hard_break') return '\n'
  if (node.type === 'horizontal_rule') return '\n---\n'
  if (node.type === 'historian_ref') {
    const { repo, commit, confirmed_by } = node.attrs ?? {}
    return `committed ${commit ?? ''} to ${repo ?? ''}${confirmed_by ? ` · confirmed by ${confirmed_by}` : ''}`
  }
  if (node.type === 'document_ref') {
    const { title, path } = node.attrs ?? {}
    return `[doc] ${title ?? path ?? ''}`
  }
  if (node.type === 'action_button') return node.attrs?.label ?? ''

  const childText = (node.content ?? []).map(extractText).join('')

  const blockTypes = new Set([
    'doc', 'paragraph', 'heading', 'blockquote',
    'bullet_list', 'list_item', 'code_block', 'action_row',
    'decision_callout', 'architecture_callout',
  ])
  return blockTypes.has(node.type) ? childText + '\n' : childText
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_KINDS = new Set(['text', 'pm', 'continuation_divider'])

/**
 * Validates kind + content_json on an inbound message.
 * Throws ServiceError for invalid inputs.
 * Returns the parsed PM doc (or null for kind='text').
 */
export function validateMessageKind({ kind, content_json, text }) {
  if (!VALID_KINDS.has(kind)) {
    throw new ServiceError('BAD_REQUEST', `Invalid message kind '${kind}'`)
  }
  if (kind !== 'pm') return null

  if (!content_json) {
    throw new ServiceError('BAD_REQUEST', 'PM message requires content_json')
  }

  let parsed
  try {
    parsed = JSON.parse(content_json)
  } catch {
    throw new ServiceError('BAD_REQUEST', 'PM message content_json is not valid JSON')
  }

  if (!parsed || parsed.type !== 'doc' || !Array.isArray(parsed.content)) {
    throw new ServiceError('BAD_REQUEST', 'PM message content_json must be a ProseMirror doc node')
  }

  if (!text?.trim()) {
    throw new ServiceError('BAD_REQUEST', 'PM message requires a plain-text fallback in the text field')
  }

  return parsed
}
