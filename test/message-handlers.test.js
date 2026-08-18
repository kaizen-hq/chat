import { test, expect } from 'bun:test'
import { handleMsgSend, handleMsgList } from '../src/ws/handlers/messageHandlers.js'

function makeCtx(overrides = {}) {
  return {
    messageService: {
      sendMessage: () => ({ msg_id: 'm_1', seq: 1, ts: 1000, priority: false, attachments: [] }),
    },
    deliveryService: { advance: () => {} },
    sendWs: () => {},
    publishChannel: () => {},
    dispatchMentions: () => {},
    ...overrides,
  }
}

const ws = { data: { userId: 'u1', displayName: 'Alice' } }

test('handleMsgSend broadcasts rendered_text with HTML for code blocks', () => {
  let published = null
  const ctx = makeCtx({ publishChannel: (_channelId, msg) => { published = msg } })
  const msg = { id: 'msg1', body: { channel_id: 'c1', text: '```js\nconsole.log("hi")\n```', client_msg_id: 'cm1' } }

  handleMsgSend(ws, msg, ctx)

  expect(published.body.rendered_text).toBeString()
  expect(published.body.rendered_text).toContain('<code')
})

test('handleMsgSend includes raw text alongside rendered_text', () => {
  let published = null
  const ctx = makeCtx({ publishChannel: (_channelId, msg) => { published = msg } })
  const rawText = '```js\nconsole.log("hi")\n```'
  const msg = { id: 'msg1', body: { channel_id: 'c1', text: rawText, client_msg_id: 'cm1' } }

  handleMsgSend(ws, msg, ctx)

  expect(published.body.text).toBe(rawText)
})

// ── reply_to in broadcast (Phase 5a) ─────────────────────────────────────────

test('handleMsgSend includes reply_to in msg.event when set', () => {
  let published = null
  const ctx = makeCtx({ publishChannel: (_ch, msg) => { published = msg } })
  const msg = { id: 'msg1', body: { channel_id: 'c1', text: 'hello', reply_to: 'm_parent' } }
  handleMsgSend(ws, msg, ctx)
  expect(published.body.reply_to).toBe('m_parent')
})

test('handleMsgSend sets reply_to to null when not provided', () => {
  let published = null
  const ctx = makeCtx({ publishChannel: (_ch, msg) => { published = msg } })
  const msg = { id: 'msg1', body: { channel_id: 'c1', text: 'hello' } }
  handleMsgSend(ws, msg, ctx)
  expect(published.body.reply_to).toBeNull()
})

// ── thread mode (Phase 5c) ────────────────────────────────────────────────────

