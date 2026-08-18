/**
 * pm-renderer.js — client-side ProseMirror JSON → HTML walker.
 *
 * Renders the narrow node type set defined in plans/kaizen-evolution.md.
 * Never accepts raw HTML from outside; all output is built from known templates.
 */

import { escHtml } from './messages.js'

/**
 * Render a PM doc JSON object to an HTML string.
 * @param {object} pmDoc  parsed ProseMirror doc
 * @returns {string}
 */
export function renderPmDoc(pmDoc) {
  if (!pmDoc || pmDoc.type !== 'doc') return ''
  return (pmDoc.content ?? []).map(renderNode).join('')
}

function renderNode(node) {
  if (!node) return ''
  switch (node.type) {
    case 'paragraph':      return `<p>${renderChildren(node)}</p>`
    case 'heading': {
      const lvl = Math.min(Math.max(node.attrs?.level ?? 2, 1), 6)
      return `<h${lvl}>${renderChildren(node)}</h${lvl}>`
    }
    case 'blockquote':     return `<blockquote>${renderChildren(node)}</blockquote>`
    case 'bullet_list':    return `<ul>${renderChildren(node)}</ul>`
    case 'list_item':      return `<li>${renderChildren(node)}</li>`
    case 'code_block':     return `<pre><code>${renderChildren(node)}</code></pre>`
    case 'horizontal_rule':return `<hr>`
    case 'hard_break':     return `<br>`
    case 'text':           return renderText(node)

    case 'decision_callout':
      return renderCallout('decision', node)
    case 'architecture_callout':
      return renderCallout('architecture', node)

    case 'historian_ref':
      return renderHistorianRef(node)

    case 'document_ref':
      return renderDocumentRef(node)

    case 'action_row':
      return `<div class="pm-action-row">${renderChildren(node)}</div>`

    case 'action_button': {
      const label = escHtml(node.attrs?.label ?? '')
      const value = escHtml(node.attrs?.value ?? '')
      return `<button class="pm-action-btn" type="button" data-pm-value="${value}">${label}</button>`
    }

    default:
      // Unknown node: render children transparently so future node types degrade gracefully
      return renderChildren(node)
  }
}

function renderChildren(node) {
  return (node.content ?? []).map(renderNode).join('')
}

function renderText(node) {
  let out = escHtml(node.text ?? '')
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':      out = `<strong>${out}</strong>`; break
      case 'italic':    out = `<em>${out}</em>`; break
      case 'code':      out = `<code>${out}</code>`; break
      case 'underline': out = `<u>${out}</u>`; break
      case 'strike':    out = `<s>${out}</s>`; break
      case 'link': {
        const href = escHtml(mark.attrs?.href ?? '#')
        out = `<a href="${href}" target="_blank" rel="noopener noreferrer">${out}</a>`
        break
      }
    }
  }
  return out
}

function renderCallout(type, node) {
  const fileRef = node.attrs?.file_ref
  const fileHtml = fileRef
    ? `<span class="pm-callout-file">${escHtml(fileRef)}</span>`
    : ''
  return `<div class="pm-callout pm-callout--${escHtml(type)}">
    <span class="pm-callout-badge">${escHtml(type)}</span>${fileHtml}
    <div class="pm-callout-body">${renderChildren(node)}</div>
  </div>`
}

function renderHistorianRef(node) {
  const { repo = '', commit = '', confirmed_by = '' } = node.attrs ?? {}
  const confirmedHtml = confirmed_by
    ? `<span class="pm-historian-confirmed">confirmed by ${escHtml(confirmed_by)}</span>`
    : ''
  return `<div class="pm-historian-ref">
    <span class="pm-historian-icon">⎇</span>
    <span class="pm-historian-text">historian committed
      <code class="pm-historian-commit">${escHtml(commit)}</code>
      to <span class="pm-historian-repo">${escHtml(repo)}</span>
    </span>
    ${confirmedHtml}
  </div>`
}

function renderDocumentRef(node) {
  const { doc_id = '', path = '', title = '', commit = '' } = node.attrs ?? {}
  const href = `/docs/${escHtml(doc_id)}`
  const commitHtml = commit
    ? `<span class="pm-docref-commit">${escHtml(commit.slice(0, 7))}</span>`
    : ''
  return `<a class="pm-docref" href="${href}">
    <span class="pm-docref-icon">📄</span>
    <span class="pm-docref-title">${escHtml(title || path)}</span>
    <span class="pm-docref-path">${escHtml(path)}</span>
    ${commitHtml}
  </a>`
}
