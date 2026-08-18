import { test, expect, beforeEach } from 'bun:test'
import { DocumentService } from '../src/services/DocumentService.js'
import { InMemoryDocumentRepository } from '../src/adapters/InMemoryDocumentRepository.js'
import { ServiceError } from '../src/util/errors.js'

function makeHubService(accessibleHubs = new Set(['h1'])) {
  return {
    canAccessHub: (hubId, userId, roles) =>
      accessibleHubs.has(hubId) || (roles ?? []).includes('admin'),
  }
}

function makeChannelService(memberChannels = new Set(['c1'])) {
  return {
    isMember: (channelId, userId) => memberChannels.has(channelId),
  }
}

let docRepo, hubService, channelService, service

beforeEach(() => {
  docRepo = new InMemoryDocumentRepository()
  hubService = makeHubService()
  channelService = makeChannelService()
  service = new DocumentService({ documentRepo: docRepo, hubService, channelService })
})

// ── pinDocument ───────────────────────────────────────────────────────────────

test('pinDocument to hub returns doc with doc_id', () => {
  const doc = service.pinDocument({
    userId: 'u1', userRoles: ['user'],
    hubId: 'h1', repo: 'decisions', path: 'adr-001.md', title: 'ADR-001',
  })
  expect(doc.doc_id).toMatch(/^doc_/)
  expect(doc.hub_id).toBe('h1')
  expect(doc.channel_id).toBeNull()
  expect(doc.repo).toBe('decisions')
  expect(doc.path).toBe('adr-001.md')
  expect(doc.title).toBe('ADR-001')
  expect(doc.pinned_by).toBe('u1')
})

test('pinDocument to channel returns doc with channel_id', () => {
  const doc = service.pinDocument({
    userId: 'u1', userRoles: ['user'],
    channelId: 'c1', repo: 'docs', path: 'readme.md', title: 'Readme',
  })
  expect(doc.channel_id).toBe('c1')
  expect(doc.hub_id).toBeNull()
})

test('pinDocument rejects when neither hub_id nor channel_id given', () => {
  expect(() =>
    service.pinDocument({ userId: 'u1', userRoles: ['user'], repo: 'docs', path: 'readme.md', title: 'X' })
  ).toThrow(ServiceError)
})

test('pinDocument to hub rejects user without hub access', () => {
  expect(() =>
    service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h-other', repo: 'docs', path: 'a.md', title: 'A' })
  ).toThrow(ServiceError)
})

test('pinDocument to channel rejects non-member', () => {
  expect(() =>
    service.pinDocument({ userId: 'u1', userRoles: ['user'], channelId: 'c-private', repo: 'docs', path: 'a.md', title: 'A' })
  ).toThrow(ServiceError)
})

test('pinDocument rejects missing repo', () => {
  expect(() =>
    service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', path: 'a.md', title: 'A' })
  ).toThrow(ServiceError)
})

test('pinDocument rejects missing path', () => {
  expect(() =>
    service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', repo: 'docs', title: 'A' })
  ).toThrow(ServiceError)
})

test('pinDocument rejects missing title', () => {
  expect(() =>
    service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', repo: 'docs', path: 'a.md' })
  ).toThrow(ServiceError)
})

// ── unpinDocument ─────────────────────────────────────────────────────────────

test('unpinDocument removes the document', () => {
  const doc = service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', repo: 'docs', path: 'a.md', title: 'A' })
  service.unpinDocument({ docId: doc.doc_id, userId: 'u1', userRoles: ['user'] })
  const remaining = service.listDocuments({ hubId: 'h1', userId: 'u1', userRoles: ['user'] })
  expect(remaining).toHaveLength(0)
})

test('unpinDocument rejects missing document', () => {
  expect(() =>
    service.unpinDocument({ docId: 'doc_nope', userId: 'u1', userRoles: ['user'] })
  ).toThrow(ServiceError)
})

test('unpinDocument rejects user without hub access', () => {
  // pin as admin
  const doc = service.pinDocument({ userId: 'u1', userRoles: ['admin'], hubId: 'h-secret', repo: 'docs', path: 'a.md', title: 'A' })
  expect(() =>
    service.unpinDocument({ docId: doc.doc_id, userId: 'u2', userRoles: ['user'] })
  ).toThrow(ServiceError)
})

// ── listDocuments ─────────────────────────────────────────────────────────────

test('listDocuments by hub returns pinned documents', () => {
  service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', repo: 'docs', path: 'a.md', title: 'A' })
  service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', repo: 'docs', path: 'b.md', title: 'B' })
  const docs = service.listDocuments({ hubId: 'h1', userId: 'u1', userRoles: ['user'] })
  expect(docs).toHaveLength(2)
})

test('listDocuments by channel returns pinned documents', () => {
  service.pinDocument({ userId: 'u1', userRoles: ['user'], channelId: 'c1', repo: 'docs', path: 'a.md', title: 'A' })
  const docs = service.listDocuments({ channelId: 'c1', userId: 'u1', userRoles: ['user'] })
  expect(docs).toHaveLength(1)
})

test('listDocuments returns empty array when none pinned', () => {
  const docs = service.listDocuments({ hubId: 'h1', userId: 'u1', userRoles: ['user'] })
  expect(docs).toHaveLength(0)
})

test('listDocuments rejects user without hub access', () => {
  expect(() =>
    service.listDocuments({ hubId: 'h-other', userId: 'u1', userRoles: ['user'] })
  ).toThrow(ServiceError)
})

test('listDocuments rejects non-member for channel', () => {
  expect(() =>
    service.listDocuments({ channelId: 'c-private', userId: 'u1', userRoles: ['user'] })
  ).toThrow(ServiceError)
})

// ── getDocumentContent (async, mesh proxy) ────────────────────────────────────

test('getDocumentContent fetches content via meshGitAdapter', async () => {
  const mockAdapter = {
    fetchRawFile: async (repo, path) => `# ${path} content`,
    getLatestCommit: async () => 'abc123',
  }
  const svc = new DocumentService({ documentRepo: docRepo, hubService, channelService, meshGitAdapter: mockAdapter })
  const doc = svc.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', repo: 'docs', path: 'a.md', title: 'A' })
  const result = await svc.getDocumentContent({ docId: doc.doc_id, userId: 'u1', userRoles: ['user'] })
  expect(result.content).toBe('# a.md content')
  expect(result.commit).toBe('abc123')
})

test('getDocumentContent rejects missing document', async () => {
  const svc = new DocumentService({ documentRepo: docRepo, hubService, channelService, meshGitAdapter: {} })
  await expect(svc.getDocumentContent({ docId: 'doc_nope', userId: 'u1', userRoles: ['user'] }))
    .rejects.toThrow(ServiceError)
})

test('getDocumentContent rejects without meshGitAdapter', async () => {
  const doc = service.pinDocument({ userId: 'u1', userRoles: ['user'], hubId: 'h1', repo: 'docs', path: 'a.md', title: 'A' })
  await expect(service.getDocumentContent({ docId: doc.doc_id, userId: 'u1', userRoles: ['user'] }))
    .rejects.toThrow(ServiceError)
})
