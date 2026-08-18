import { test, expect, beforeEach } from 'bun:test'
import { AuthService } from '../src/services/AuthService.js'
import { InMemoryAuthRepository } from '../src/adapters/InMemoryAuthRepository.js'
import { ServiceError } from '../src/util/errors.js'

let repo, service

function makeService(overrides = {}) {
  repo = new InMemoryAuthRepository()
  service = new AuthService({ authRepo: repo, nowFn: () => 1000, sessionTtlMs: 86400000, ...overrides })
  return { repo, service }
}

beforeEach(() => { makeService() })

test('redeemInvite creates user and returns session token', async () => {
  // seed an admin user so createInvite works
  repo.registerBootstrapUser({ userId: 'u_admin', handle: 'admin', displayName: 'Admin', rolesJson: JSON.stringify(['admin']), passwordHash: 'x', now: 1000, sessionId: 's0', sessionTokenHash: 'h0', sessionExpiresAt: 9999999 })

  const { inviteToken } = service.createInvite({ createdByUserId: 'u_admin' })
  const result = await service.redeemInvite({ inviteToken, profile: { handle: 'alice' }, password: 'secret123' })

  expect(result.sessionToken).toBeTruthy()
  expect(result.user.handle).toBe('alice')
  expect(result.user.roles).toContain('user')
})

test('redeemInvite throws when invite is expired', async () => {
  repo.registerBootstrapUser({ userId: 'u_admin', handle: 'admin', displayName: 'Admin', rolesJson: JSON.stringify(['admin']), passwordHash: 'x', now: 1000, sessionId: 's0', sessionTokenHash: 'h0', sessionExpiresAt: 9999999 })

  const { inviteToken } = service.createInvite({ createdByUserId: 'u_admin', ttlMs: 1 })
  // nowFn advances past expiry
  service.nowFn = () => 9999999
  await expect(service.redeemInvite({ inviteToken, profile: { handle: 'bob' }, password: 'secret' })).rejects.toThrow(ServiceError)
})

test('tryBootstrap creates admin user when no users exist', async () => {
  const { service: s } = makeService({ bootstrapToken: 'boot-tok' })
  const result = await s.redeemInvite({ inviteToken: 'boot-tok', profile: { handle: 'firstadmin' }, password: 'pass123' })
  expect(result.user.roles).toContain('admin')
  expect(result.sessionToken).toBeTruthy()
})

test('tryBootstrap is rejected when users already exist', async () => {
  const { service: s, repo: r } = makeService({ bootstrapToken: 'boot-tok' })
  r.registerBootstrapUser({ userId: 'u1', handle: 'existing', displayName: 'X', rolesJson: '["user"]', passwordHash: 'x', now: 1000, sessionId: 's1', sessionTokenHash: 'h1', sessionExpiresAt: 9999999 })
  await expect(s.redeemInvite({ inviteToken: 'boot-tok', profile: { handle: 'admin' }, password: 'pass' })).rejects.toThrow(ServiceError)
})

test('signInWithPassword returns session token for valid credentials', async () => {
  const { service: s, repo: r } = makeService({ bootstrapToken: 'boot-tok' })
  await s.redeemInvite({ inviteToken: 'boot-tok', profile: { handle: 'firstadmin' }, password: 'mypassword' })
  const result = await s.signInWithPassword({ handle: 'firstadmin', password: 'mypassword' })
  expect(result.sessionToken).toBeTruthy()
  expect(result.user.handle).toBe('firstadmin')
})

test('signInWithPassword throws AUTH_FAILED for wrong password', async () => {
  const { service: s } = makeService({ bootstrapToken: 'boot-tok' })
  await s.redeemInvite({ inviteToken: 'boot-tok', profile: { handle: 'firstadmin' }, password: 'mypassword' })
  await expect(s.signInWithPassword({ handle: 'firstadmin', password: 'wrongpassword' })).rejects.toThrow(ServiceError)
})

test('validateSession returns user for valid token', async () => {
  const { service: s } = makeService({ bootstrapToken: 'boot-tok' })
  const { sessionToken } = await s.redeemInvite({ inviteToken: 'boot-tok', profile: { handle: 'admin' }, password: 'pass' })
  const result = s.validateSession(sessionToken)
  expect(result?.user?.handle).toBe('admin')
})

test('validateSession returns null after revokeSession', async () => {
  const { service: s } = makeService({ bootstrapToken: 'boot-tok' })
  const { sessionToken } = await s.redeemInvite({ inviteToken: 'boot-tok', profile: { handle: 'admin' }, password: 'pass' })
  const { session_id } = s.validateSession(sessionToken)
  s.revokeSession(session_id)
  expect(s.validateSession(sessionToken)).toBeNull()
})

test('createInvite throws FORBIDDEN for non-admin user', () => {
  repo.registerBootstrapUser({ userId: 'u_regular', handle: 'regular', displayName: 'Regular', rolesJson: JSON.stringify(['user']), passwordHash: 'x', now: 1000, sessionId: 's0', sessionTokenHash: 'h0', sessionExpiresAt: 9999999 })
  expect(() => service.createInvite({ createdByUserId: 'u_regular' })).toThrow(ServiceError)
})

// ── Entra SSO ─────────────────────────────────────────────────────────────────

test('signInWithEntra creates a new user on first login', async () => {
  const result = await service.signInWithEntra({ oid: 'entra-oid-1', email: 'joey@example.com', upn: 'joey@example.com', displayName: 'Joey Guerra' })
  expect(result.sessionToken).toBeTruthy()
  expect(result.user.display_name).toBe('Joey Guerra')
})

test('signInWithEntra returns same user on subsequent login with same oid', async () => {
  const first = await service.signInWithEntra({ oid: 'entra-oid-1', email: 'joey@example.com', upn: 'joey@example.com', displayName: 'Joey' })
  const second = await service.signInWithEntra({ oid: 'entra-oid-1', email: 'joey@example.com', upn: 'joey@example.com', displayName: 'Joey' })
  expect(second.user.user_id).toBe(first.user.user_id)
})

test('signInWithEntra maps returning user by oid even if upn changes', async () => {
  const first = await service.signInWithEntra({ oid: 'entra-oid-1', email: 'old@example.com', upn: 'old@example.com', displayName: 'Joey' })
  const second = await service.signInWithEntra({ oid: 'entra-oid-1', email: 'new@example.com', upn: 'new@example.com', displayName: 'Joey' })
  expect(second.user.user_id).toBe(first.user.user_id)
})

test('signInWithPassword rejects a user with allow_local_auth=0 (Entra-only account)', async () => {
  await service.signInWithEntra({ oid: 'entra-oid-2', email: 'maya@example.com', upn: 'maya@example.com', displayName: 'Maya' })
  const user = repo.findUserByEntraOid({ oid: 'entra-oid-2' })
  await expect(service.signInWithPassword({ handle: user.handle, password: 'anything' }))
    .rejects.toThrow(ServiceError)
})

test('signInWithPassword succeeds for bootstrap user (allow_local_auth=1)', async () => {
  const { service: s } = makeService({ bootstrapToken: 'boot-tok' })
  await s.redeemInvite({ inviteToken: 'boot-tok', profile: { handle: 'admin' }, password: 'mypassword' })
  await expect(s.signInWithPassword({ handle: 'admin', password: 'mypassword' })).resolves.toBeTruthy()
})

test('createEntraAdminPlaceholder returns an activation token when no users exist', () => {
  const token = service.createEntraAdminPlaceholder()
  expect(token).toBeTruthy()
  expect(typeof token).toBe('string')
})

test('createEntraAdminPlaceholder returns null when users already exist', async () => {
  await service.signInWithEntra({ oid: 'oid-existing', email: 'x@x.com', upn: 'x@x.com', displayName: 'X' })
  expect(service.createEntraAdminPlaceholder()).toBeNull()
})

test('activateEntraAdmin binds oid to the placeholder admin account', async () => {
  const token = service.createEntraAdminPlaceholder()
  const result = await service.activateEntraAdmin({ activationToken: token, oid: 'oid-admin', email: 'admin@example.com', upn: 'admin@example.com', displayName: 'Admin' })
  expect(result.sessionToken).toBeTruthy()
  expect(result.user.roles).toContain('admin')
})

test('activateEntraAdmin fails with an invalid token', async () => {
  service.createEntraAdminPlaceholder()
  await expect(service.activateEntraAdmin({ activationToken: 'wrong', oid: 'oid-x', email: 'x@x.com', upn: 'x@x.com', displayName: 'X' }))
    .rejects.toThrow(ServiceError)
})

test('activateEntraAdmin fails if token already used', async () => {
  const token = service.createEntraAdminPlaceholder()
  await service.activateEntraAdmin({ activationToken: token, oid: 'oid-admin', email: 'a@a.com', upn: 'a@a.com', displayName: 'A' })
  await expect(service.activateEntraAdmin({ activationToken: token, oid: 'oid-admin2', email: 'b@b.com', upn: 'b@b.com', displayName: 'B' }))
    .rejects.toThrow(ServiceError)
})
