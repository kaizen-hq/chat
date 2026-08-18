export class InMemoryAuthRepository {
  constructor() {
    this._users = new Map()     // userId → user record
    this._sessions = new Map()  // sessionId → session record
    this._invites = new Map()   // tokenHash → invite record
  }

  // ── Invites ────────────────────────────────────────────────────────────────

  insertInvite({ inviteId, tokenHash, createdByUserId, now, expiresAt, maxUses, note, initialRolesJson }) {
    this._invites.set(tokenHash, { invite_id: inviteId, token_hash: tokenHash, created_by_user_id: createdByUserId, created_at: now, expires_at: expiresAt, max_uses: maxUses, uses: 0, note, initial_roles_json: initialRolesJson, redeemed_by_user_id: null })
  }

  findInviteByTokenHash({ tokenHash }) {
    return this._invites.get(tokenHash) ?? null
  }

  listInvites() {
    return [...this._invites.values()]
  }

  deleteInvite({ inviteId }) {
    for (const [k, v] of this._invites.entries()) {
      if (v.invite_id === inviteId) { this._invites.delete(k); break }
    }
  }

  registerUser({ inviteId, userId, handle, displayName, rolesJson, passwordHash, now, sessionId, sessionTokenHash, sessionExpiresAt }) {
    this._users.set(userId, { user_id: userId, handle, display_name: displayName, roles_json: rolesJson, password_hash: passwordHash, created_at: now, allow_local_auth: 1, entra_oid: null, email: null, upn: null, activation_token_hash: null })
    for (const invite of this._invites.values()) {
      if (invite.invite_id === inviteId) { invite.uses += 1; invite.redeemed_by_user_id = userId; break }
    }
    this._sessions.set(sessionId, { session_id: sessionId, user_id: userId, token_hash: sessionTokenHash, created_at: now, expires_at: sessionExpiresAt, last_seen_at: now, revoked_at: null, access_token: null, refresh_token: null })
  }

  registerBootstrapUser({ userId, handle, displayName, rolesJson, passwordHash, now, sessionId, sessionTokenHash, sessionExpiresAt }) {
    this._users.set(userId, { user_id: userId, handle, display_name: displayName, roles_json: rolesJson, password_hash: passwordHash, created_at: now, allow_local_auth: 1, entra_oid: null, email: null, upn: null, activation_token_hash: null })
    this._sessions.set(sessionId, { session_id: sessionId, user_id: userId, token_hash: sessionTokenHash, created_at: now, expires_at: sessionExpiresAt, last_seen_at: now, revoked_at: null, access_token: null, refresh_token: null })
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  findUserByHandle({ handle }) {
    return [...this._users.values()].find(u => u.handle === handle) ?? null
  }

  findUserById({ userId }) {
    const u = this._users.get(userId)
    if (!u) return null
    return { user_id: u.user_id, handle: u.handle, display_name: u.display_name, roles_json: u.roles_json }
  }

  findUserByEmail({ email }) {
    return [...this._users.values()].find(u => u.email === email) ?? null
  }

  findUserByEntraOid({ oid }) {
    return [...this._users.values()].find(u => u.entra_oid === oid) ?? null
  }

  findUserByActivationToken({ tokenHash }) {
    return [...this._users.values()].find(u => u.activation_token_hash === tokenHash) ?? null
  }

  getUserCount() {
    return this._users.size
  }

  isHandleTaken({ handle }) {
    return [...this._users.values()].some(u => u.handle === handle)
  }

  updateUserRoles({ userId, rolesJson }) {
    const u = this._users.get(userId)
    if (u) u.roles_json = rolesJson
  }

  updateUserPassword({ userId, passwordHash }) {
    const u = this._users.get(userId)
    if (u) u.password_hash = passwordHash
  }

  updateUserDisplayName({ userId, displayName }) {
    const u = this._users.get(userId)
    if (u) u.display_name = displayName
  }

  listUsers() {
    return [...this._users.values()].map(u => ({
      user_id: u.user_id, handle: u.handle, display_name: u.display_name,
      roles_json: u.roles_json, email: u.email ?? null, created_at: u.created_at,
    }))
  }

  // ── Entra identity ─────────────────────────────────────────────────────────

  createEntraUser({ userId, handle, displayName, email, upn, entraOid, rolesJson, now }) {
    this._users.set(userId, { user_id: userId, handle, display_name: displayName, roles_json: rolesJson, password_hash: null, created_at: now, allow_local_auth: 0, entra_oid: entraOid, email, upn, activation_token_hash: null })
  }

  createEntraAdminPlaceholder({ userId, activationTokenHash, now }) {
    const handle = `admin-${userId.slice(-6)}`
    this._users.set(userId, { user_id: userId, handle, display_name: 'Admin', roles_json: '["admin"]', password_hash: null, created_at: now, allow_local_auth: 0, entra_oid: null, email: null, upn: null, activation_token_hash: activationTokenHash })
  }

  bindEntraOid({ userId, oid, email, upn, displayName }) {
    const u = this._users.get(userId)
    if (!u) return
    u.entra_oid = oid
    u.email = email
    u.upn = upn
    if (displayName) u.display_name = displayName
    u.activation_token_hash = null  // consume the activation token
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  insertSession({ sessionId, userId, tokenHash, now, expiresAt, accessToken = null, refreshToken = null }) {
    this._sessions.set(sessionId, { session_id: sessionId, user_id: userId, token_hash: tokenHash, created_at: now, expires_at: expiresAt, last_seen_at: now, revoked_at: null, access_token: accessToken, refresh_token: refreshToken })
  }

  findSessionWithUser({ tokenHash }) {
    const session = [...this._sessions.values()].find(s => s.token_hash === tokenHash)
    if (!session) return null
    const user = this._users.get(session.user_id)
    if (!user) return null
    return { session_id: session.session_id, user_id: user.user_id, expires_at: session.expires_at, revoked_at: session.revoked_at, last_seen_at: session.last_seen_at, handle: user.handle, display_name: user.display_name, roles_json: user.roles_json }
  }

  findSessionTokens({ sessionId }) {
    const s = this._sessions.get(sessionId)
    if (!s) return null
    return { access_token: s.access_token ?? null, refresh_token: s.refresh_token ?? null }
  }

  touchSession({ sessionId, now }) {
    const s = this._sessions.get(sessionId)
    if (s) s.last_seen_at = now
  }

  revokeSession({ sessionId, now }) {
    const s = this._sessions.get(sessionId)
    if (s) s.revoked_at = now
  }

  revokeAllUserSessions({ userId, now }) {
    for (const s of this._sessions.values()) {
      if (s.user_id === userId && !s.revoked_at) s.revoked_at = now
    }
  }
}
