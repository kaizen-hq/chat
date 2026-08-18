import { newId } from '../util/ids.js'
import { randomToken, hashToken, hashPassword, verifyPassword } from '../util/crypto.js'
import { ServiceError } from '../util/errors.js'
import { decryptToken } from '../util/tokenCipher.js'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export class AuthService {
  constructor({ authRepo, nowFn = () => Date.now(), sessionTtlMs = DEFAULT_SESSION_TTL_MS, bootstrapToken = null, encryptionKey = null }) {
    this.authRepo = authRepo
    this.nowFn = nowFn
    this.sessionTtlMs = sessionTtlMs
    this.bootstrapToken = bootstrapToken
    this.encryptionKey = encryptionKey
  }

  createInvite({ createdByUserId, ttlMs = DEFAULT_TTL_MS, maxUses = 1, note = null, roles = ['user'] }) {
    this.requireAdmin(createdByUserId)
    if (!Array.isArray(roles) || roles.length === 0) throw new ServiceError('BAD_REQUEST', 'roles must be a non-empty array')
    const inviteToken = randomToken()
    const inviteId = newId('invite')
    const now = this.nowFn()
    const expiresAt = now + ttlMs
    this.authRepo.insertInvite({ inviteId, tokenHash: hashToken(inviteToken), createdByUserId, now, expiresAt, maxUses, note, initialRolesJson: JSON.stringify(roles) })
    return { inviteToken, inviteId, expiresAt, maxUses, roles }
  }

  listInvites({ requestingUserId }) {
    this.requireAdmin(requestingUserId)
    return this.authRepo.listInvites()
  }

  revokeInvite({ inviteId, requestingUserId }) {
    this.requireAdmin(requestingUserId)
    this.authRepo.deleteInvite({ inviteId })
  }

  async redeemInvite({ inviteToken, profile, password }) {
    const invite = this.authRepo.findInviteByTokenHash({ tokenHash: hashToken(inviteToken) })
    const now = this.nowFn()
    if (!invite) {
      const bootstrap = await this.tryBootstrap({ inviteToken, profile, now, password })
      if (bootstrap) return bootstrap
      throw new ServiceError('AUTH_FAILED', 'Invite token is invalid')
    }
    if (invite.expires_at <= now) throw new ServiceError('AUTH_FAILED', 'Invite token has expired')
    if (invite.uses >= invite.max_uses) throw new ServiceError('AUTH_FAILED', 'Invite token has been used')
    const handle = profile?.handle?.trim()
    const displayName = profile?.display_name?.trim() || handle
    if (!handle) throw new ServiceError('BAD_REQUEST', 'Handle is required')
    if (!password) throw new ServiceError('BAD_REQUEST', 'Password is required')
    if (this.authRepo.isHandleTaken({ handle })) throw new ServiceError('CONFLICT', 'Handle already taken')
    const userId = newId('u')
    const roles = invite.initial_roles_json ? JSON.parse(invite.initial_roles_json) : this.getDefaultRoles()
    const passwordHash = await hashPassword(password)
    const { sessionId, sessionToken, expiresAt } = this._makeSessionParts(now)
    this.authRepo.registerUser({
      inviteId: invite.invite_id,
      userId, handle, displayName,
      rolesJson: JSON.stringify(roles),
      passwordHash, now,
      sessionId, sessionTokenHash: hashToken(sessionToken), sessionExpiresAt: expiresAt
    })
    return {
      sessionToken,
      user: { user_id: userId, handle, display_name: displayName, roles }
    }
  }

  async tryBootstrap({ inviteToken, profile, now, password }) {
    if (!this.bootstrapToken || inviteToken !== this.bootstrapToken) return null
    if (this.authRepo.getUserCount() > 0) return null
    const handle = profile?.handle?.trim()
    const displayName = profile?.display_name?.trim() || handle
    if (!handle) throw new ServiceError('BAD_REQUEST', 'Handle is required')
    if (!password) throw new ServiceError('BAD_REQUEST', 'Password is required')
    if (this.authRepo.isHandleTaken({ handle })) throw new ServiceError('CONFLICT', 'Handle already taken')
    const userId = newId('u')
    const roles = ['admin']
    const passwordHash = await hashPassword(password)
    const { sessionId, sessionToken, expiresAt } = this._makeSessionParts(now)
    this.authRepo.registerBootstrapUser({
      userId, handle, displayName,
      rolesJson: JSON.stringify(roles),
      passwordHash, now,
      sessionId, sessionTokenHash: hashToken(sessionToken), sessionExpiresAt: expiresAt
    })
    this.bootstrapToken = null
    return {
      sessionToken,
      user: { user_id: userId, handle, display_name: displayName, roles }
    }
  }

  async signInWithPassword({ handle, password }) {
    if (!handle || !password) throw new ServiceError('BAD_REQUEST', 'Handle and password required')
    const row = this.authRepo.findUserByHandle({ handle })
    if (!row || !row.password_hash) throw new ServiceError('AUTH_FAILED', 'Invalid handle or password')
    if (!row.allow_local_auth) throw new ServiceError('AUTH_FAILED', 'Local authentication is not enabled for this account')
    const isValid = await verifyPassword(password, row.password_hash)
    if (!isValid) throw new ServiceError('AUTH_FAILED', 'Invalid handle or password')
    const now = this.nowFn()
    const { sessionId, sessionToken, expiresAt } = this._makeSessionParts(now)
    this.authRepo.insertSession({ sessionId, userId: row.user_id, tokenHash: hashToken(sessionToken), now, expiresAt })
    return {
      sessionToken,
      user: { user_id: row.user_id, handle: row.handle, display_name: row.display_name, roles: JSON.parse(row.roles_json) }
    }
  }

  // ── Entra OIDC ──────────────────────────────────────────────────────────────

  async signInWithEntra({ oid, email, upn, displayName, accessToken = null, refreshToken = null }) {
    if (!oid) throw new ServiceError('BAD_REQUEST', 'Entra OID is required')
    const now = this.nowFn()
    const row = this.authRepo.findUserByEntraOid({ oid })
    let user
    if (row) {
      user = { user_id: row.user_id, handle: row.handle, display_name: row.display_name, roles: JSON.parse(row.roles_json) }
    } else {
      const handle = this._deriveHandle(upn ?? email ?? oid)
      const userId = newId('u')
      this.authRepo.createEntraUser({ userId, handle, displayName: displayName ?? handle, email, upn, entraOid: oid, rolesJson: JSON.stringify(['user']), now })
      user = { user_id: userId, handle, display_name: displayName ?? handle, roles: ['user'] }
    }
    const { sessionId, sessionToken, expiresAt } = this._makeSessionParts(now)
    this.authRepo.insertSession({ sessionId, userId: user.user_id, tokenHash: hashToken(sessionToken), now, expiresAt, accessToken, refreshToken })
    return { sessionToken, user }
  }

  createEntraAdminPlaceholder() {
    if (this.authRepo.getUserCount() > 0) return null
    const activationToken = randomToken(24)
    const userId = newId('u')
    const now = this.nowFn()
    this.authRepo.createEntraAdminPlaceholder({ userId, activationTokenHash: hashToken(activationToken), now })
    return activationToken
  }

  async activateEntraAdmin({ activationToken, oid, email, upn, displayName, accessToken = null, refreshToken = null }) {
    const user = this.authRepo.findUserByActivationToken({ tokenHash: hashToken(activationToken) })
    if (!user) throw new ServiceError('AUTH_FAILED', 'Activation token is invalid or already used')
    const now = this.nowFn()
    this.authRepo.bindEntraOid({ userId: user.user_id, oid, email, upn, displayName: displayName ?? user.display_name })
    const { sessionId, sessionToken, expiresAt } = this._makeSessionParts(now)
    this.authRepo.insertSession({ sessionId, userId: user.user_id, tokenHash: hashToken(sessionToken), now, expiresAt, accessToken, refreshToken })
    return {
      sessionToken,
      user: { user_id: user.user_id, handle: user.handle, display_name: displayName ?? user.display_name, roles: JSON.parse(user.roles_json) }
    }
  }

  _deriveHandle(upn) {
    const base = (upn ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9_.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'user'
    if (!this.authRepo.isHandleTaken({ handle: base })) return base
    let i = 2
    while (this.authRepo.isHandleTaken({ handle: `${base}-${i}` })) i++
    return `${base}-${i}`
  }

  createSession(userId) {
    const now = this.nowFn()
    const { sessionId, sessionToken, expiresAt } = this._makeSessionParts(now)
    this.authRepo.insertSession({ sessionId, userId, tokenHash: hashToken(sessionToken), now, expiresAt })
    return { sessionId, sessionToken, expiresAt }
  }

  validateSession(sessionToken) {
    if (!sessionToken) return null
    const now = this.nowFn()
    const row = this.authRepo.findSessionWithUser({ tokenHash: hashToken(sessionToken) })
    if (!row || row.revoked_at || row.expires_at <= now) return null
    const lastSeenAt = row.last_seen_at ?? null
    this.authRepo.touchSession({ sessionId: row.session_id, now })
    return {
      session_id: row.session_id,
      last_seen_at: lastSeenAt,
      user: { user_id: row.user_id, handle: row.handle, display_name: row.display_name, roles: JSON.parse(row.roles_json) }
    }
  }

  revokeSession(sessionId) {
    this.authRepo.revokeSession({ sessionId, now: this.nowFn() })
  }

  // ── User management (admin only) ───────────────────────────────────────────

  listUsers({ requestingUserId }) {
    this.requireAdmin(requestingUserId)
    return this.authRepo.listUsers().map(row => ({
      user_id:      row.user_id,
      handle:       row.handle,
      display_name: row.display_name,
      roles:        JSON.parse(row.roles_json),
      created_at:   row.created_at,
    }))
  }

  setUserRoles({ targetUserId, roles, requestingUserId }) {
    this.requireAdmin(requestingUserId)
    if (!Array.isArray(roles)) throw new ServiceError('BAD_REQUEST', 'roles must be an array')
    this.authRepo.updateUserRoles({ userId: targetUserId, rolesJson: JSON.stringify(roles) })
  }

  async adminSetPassword({ targetUserId, newPassword, requestingUserId }) {
    this.requireAdmin(requestingUserId)
    if (!newPassword || newPassword.length < 8) throw new ServiceError('BAD_REQUEST', 'Password must be at least 8 characters')
    const passwordHash = await hashPassword(newPassword)
    this.authRepo.updateUserPassword({ userId: targetUserId, passwordHash })
    this.authRepo.revokeAllUserSessions({ userId: targetUserId, now: this.nowFn() })
  }

  adminUpdateDisplayName({ targetUserId, displayName, requestingUserId }) {
    this.requireAdmin(requestingUserId)
    const name = displayName?.trim()
    if (!name) throw new ServiceError('BAD_REQUEST', 'Display name is required')
    this.authRepo.updateUserDisplayName({ userId: targetUserId, displayName: name })
  }

  requireAdmin(userId) {
    const user = this.getUser(userId)
    if (!user || !user.roles.includes('admin')) throw new ServiceError('FORBIDDEN', 'Admin role required')
  }

  getUser(userId) {
    const row = this.authRepo.findUserById({ userId })
    if (!row) return null
    return { user_id: row.user_id, handle: row.handle, display_name: row.display_name, roles: JSON.parse(row.roles_json) }
  }

  findUserByEmail(email) {
    return this.authRepo.findUserByEmail({ email }) ?? null
  }

  findInvite(inviteToken) {
    return this.authRepo.findInviteByTokenHash({ tokenHash: hashToken(inviteToken) })
  }

  listUsersBasic() {
    return this.authRepo.listUsers().map(row => ({
      user_id:      row.user_id,
      handle:       row.handle,
      display_name: row.display_name,
      email:        row.email ?? null,
      roles:        JSON.parse(row.roles_json),
    }))
  }

  searchUsers({ query, excludeUserId = null }) {
    const q = query.toLowerCase().trim()
    if (!q) return []
    return this.listUsersBasic()
      .filter(u => {
        if (u.roles.includes('bot')) return false
        if (excludeUserId && u.user_id === excludeUserId) return false
        return u.handle.toLowerCase().includes(q)
          || u.display_name.toLowerCase().includes(q)
          || (u.email ?? '').toLowerCase().includes(q)
      })
      .slice(0, 10)
  }

  getDefaultRoles() { return ['user'] }

  getUserCount() {
    return this.authRepo.getUserCount()
  }

  isHandleTaken(handle) {
    return this.authRepo.isHandleTaken({ handle })
  }

  /**
   * Retrieve and decrypt the Graph API tokens stored in a session.
   * Returns null if the session doesn't exist.
   * @param {{ sessionId: string }} opts
   * @returns {{ accessToken: string|null, refreshToken: string|null }|null}
   */
  getSessionTokens({ sessionId }) {
    const row = this.authRepo.findSessionTokens({ sessionId })
    if (!row) return null
    return {
      accessToken:  row.access_token  ? decryptToken(row.access_token,  this.encryptionKey) : null,
      refreshToken: row.refresh_token ? decryptToken(row.refresh_token, this.encryptionKey) : null,
    }
  }

  _makeSessionParts(now) {
    const sessionId = newId('s')
    const sessionToken = randomToken(32)
    const expiresAt = now + this.sessionTtlMs
    return { sessionId, sessionToken, expiresAt }
  }
}
