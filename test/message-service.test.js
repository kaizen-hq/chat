import { test, expect, beforeEach } from 'bun:test'
import { MessageService } from '../src/services/MessageService.js'
import { InMemoryMessageRepository } from '../src/adapters/InMemoryMessageRepository.js'
import { InMemorySearchRepository } from '../src/adapters/InMemorySearchRepository.js'
import { SearchService } from '../src/services/SearchService.js'
import { ServiceError } from '../src/util/errors.js'

// Minimal channel service stub — member list controlled per test
function makeChannelService(members = new Set()) {
  return { isMember: (channelId, userId) => members.has(userId) }
}

let messageRepo, searchRepo, searchService, service

beforeEach(() => {
  messageRepo = new InMemoryMessageRepository()
  searchRepo = new InMemorySearchRepository()
  searchService = new SearchService({ searchRepo })
  service = new MessageService({
    messageRepo,
    nowFn: () => 1000,
    channelService: makeChannelService(new Set(['u1', 'u2'])),
    searchService,
  })
})

test('sendMessage returns msg_id, seq, ts', () => {
  const result = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'hello' })
  expect(result.msg_id).toMatch(/^m_/)
  expect(result.seq).toBe(1)
  expect(result.ts).toBe(1000)
})

test('sendMessage increments seq per channel', () => {
  const a = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'first' })
  const b = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'second' })
  expect(b.seq).toBe(a.seq + 1)
})

test('sendMessage indexes the message for search', () => {
  service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'unique token xyz' })
  const results = searchService.searchMessages({ channelId: 'c1', query: 'xyz' })
  expect(results.length).toBe(1)
})

test('sendMessage throws FORBIDDEN when user is not a member', () => {
  expect(() => service.sendMessage({ channelId: 'c1', userId: 'outsider', text: 'hi' }))
    .toThrow(ServiceError)
})

test('sendMessage throws BAD_REQUEST for empty text', () => {
  expect(() => service.sendMessage({ channelId: 'c1', userId: 'u1', text: '   ' }))
    .toThrow(ServiceError)
})

// ── editMessage ───────────────────────────────────────────────────────────────

test('editMessage updates text and sets edited_at', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  const result = service.editMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1', newText: 'updated' })
  expect(result.text).toBe('updated')
  expect(result.editedAt).toBeDefined()
  expect(typeof result.editedAt).toBe('number')
})

test('editMessage throws FORBIDDEN when userId is not the author', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  expect(() => service.editMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u2', newText: 'hacked' }))
    .toThrow(ServiceError)
})

test('editMessage throws BAD_REQUEST for blank text', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  expect(() => service.editMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1', newText: '   ' }))
    .toThrow(ServiceError)
})

test('editMessage throws NOT_FOUND for unknown msgId', () => {
  expect(() => service.editMessage({ msgId: 'm_fake', channelId: 'c1', userId: 'u1', newText: 'hi' }))
    .toThrow(ServiceError)
})

test('editMessage throws BAD_REQUEST when message belongs to a different channel', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  expect(() => service.editMessage({ msgId: sent.msg_id, channelId: 'c2', userId: 'u1', newText: 'hi' }))
    .toThrow(ServiceError)
})

test('editMessage re-indexes text in search', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'before edit' })
  service.editMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1', newText: 'after edit uniquetoken' })
  const hits = searchService.searchMessages({ channelId: 'c1', query: 'uniquetoken' })
  expect(hits.length).toBe(1)
})

// ── deleteMessage ─────────────────────────────────────────────────────────────

test('deleteMessage removes the message from search', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'findme' })
  service.deleteMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1' })
  const hits = searchService.searchMessages({ channelId: 'c1', query: 'findme' })
  expect(hits.length).toBe(0)
})

test('deleteMessage throws FORBIDDEN when userId is not the author', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'mine' })
  expect(() => service.deleteMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u2' }))
    .toThrow(ServiceError)
})

test('deleteMessage throws NOT_FOUND for unknown msgId', () => {
  expect(() => service.deleteMessage({ msgId: 'm_fake', channelId: 'c1', userId: 'u1' }))
    .toThrow(ServiceError)
})

test('deleteMessage throws BAD_REQUEST when already deleted', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'bye' })
  service.deleteMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1' })
  expect(() => service.deleteMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1' }))
    .toThrow(ServiceError)
})

test('deleted messages are excluded from listMessages', () => {
  const a = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'keep' })
  const b = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'delete me' })
  service.deleteMessage({ msgId: b.msg_id, channelId: 'c1', userId: 'u1' })
  const { messages } = service.listMessages({ channelId: 'c1', userId: 'u1', afterSeq: 0 })
  expect(messages.length).toBe(1)
  expect(messages[0].msg_id).toBe(a.msg_id)
})

test('editMessage throws BAD_REQUEST on a deleted message', () => {
  const sent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  service.deleteMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1' })
  expect(() => service.editMessage({ msgId: sent.msg_id, channelId: 'c1', userId: 'u1', newText: 'too late' }))
    .toThrow(ServiceError)
})

// ── listMessages ──────────────────────────────────────────────────────────────

test('listMessages returns messages in seq order after afterSeq', () => {
  service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'one' })
  service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'two' })
  service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'three' })

  const { messages, next_after_seq } = service.listMessages({ channelId: 'c1', userId: 'u1', afterSeq: 1 })
  expect(messages.length).toBe(2)
  expect(messages[0].text).toBe('two')
  expect(next_after_seq).toBe(3)
})

// ── kind='pm' messages ────────────────────────────────────────────────────────

import { doc, paragraph, text as pmText } from '../src/core/pmDoc.js'

function validPmMsg(body = 'fallback') {
  return {
    kind: 'pm',
    content_json: JSON.stringify(doc(paragraph(pmText(body)))),
    text: body,
  }
}

test('sendMessage with kind=pm stores kind and content_json', () => {
  const pm = validPmMsg('Cut over to live')
  const result = service.sendMessage({ channelId: 'c1', userId: 'u1', ...pm })
  expect(result.msg_id).toMatch(/^m_/)
  const stored = service.messageRepo.getById(result.msg_id)
  expect(stored.kind).toBe('pm')
  expect(stored.content_json).toBe(pm.content_json)
})

test('sendMessage with kind=pm and no text fallback is rejected', () => {
  expect(() => service.sendMessage({
    channelId: 'c1', userId: 'u1',
    kind: 'pm',
    content_json: JSON.stringify(doc(paragraph(pmText('hi')))),
    text: '   ',
  })).toThrow(ServiceError)
})

test('sendMessage with kind=pm and no content_json is rejected', () => {
  expect(() => service.sendMessage({
    channelId: 'c1', userId: 'u1',
    kind: 'pm',
    text: 'fallback',
  })).toThrow(ServiceError)
})

test('sendMessage with unknown kind is rejected', () => {
  expect(() => service.sendMessage({
    channelId: 'c1', userId: 'u1',
    kind: 'html',
    text: '<b>hi</b>',
  })).toThrow(ServiceError)
})

test('sendMessage defaults to kind=text when kind is omitted', () => {
  const result = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'hello' })
  const stored = service.messageRepo.getById(result.msg_id)
  expect(stored.kind).toBe('text')
})

test('listMessages returns kind and content_json for pm messages', () => {
  const pm = validPmMsg('summary')
  service.sendMessage({ channelId: 'c1', userId: 'u1', ...pm })
  const { messages } = service.listMessages({ channelId: 'c1', userId: 'u1' })
  expect(messages[0].kind).toBe('pm')
  expect(messages[0].content_json).toBe(pm.content_json)
})

// ── reply_to validation (Phase 5a) ────────────────────────────────────────────

test('sendMessage with valid reply_to accepts the message', () => {
  const parent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  const reply = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'reply', replyTo: parent.msg_id })
  expect(reply.msg_id).toMatch(/^m_/)
})

test('sendMessage with reply_to pointing to nonexistent msg is rejected', () => {
  expect(() =>
    service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'reply', replyTo: 'm_nope' })
  ).toThrow(ServiceError)
})

test('sendMessage with reply_to pointing to a msg in a different channel is rejected', () => {
  const other = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  expect(() =>
    service.sendMessage({ channelId: 'c2', userId: 'u1', text: 'reply', replyTo: other.msg_id })
  ).toThrow(ServiceError)
})

test('sendMessage stores reply_to on the message', () => {
  const parent = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'original' })
  const reply = service.sendMessage({ channelId: 'c1', userId: 'u1', text: 'reply', replyTo: parent.msg_id })
  const stored = messageRepo.getById(reply.msg_id)
  expect(stored.reply_to).toBe(parent.msg_id)
})
