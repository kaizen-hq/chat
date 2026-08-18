import { newId } from '../util/ids.js'
import { ServiceError } from '../util/errors.js'

export class DocumentService {
  /**
   * @param {object} deps
   * @param {object} deps.documentRepo
   * @param {object} deps.hubService
   * @param {object} deps.channelService
   * @param {object} [deps.meshGitAdapter]  optional — null if MESH_BASE_URL not set
   * @param {() => string} [deps.nowFn]     returns ISO-8601 timestamp
   */
  constructor({ documentRepo, hubService, channelService, meshGitAdapter = null, nowFn = () => new Date().toISOString() }) {
    this.documentRepo   = documentRepo
    this.hubService     = hubService
    this.channelService = channelService
    this.meshGitAdapter = meshGitAdapter
    this.nowFn          = nowFn
  }

  // ── Access helpers ─────────────────────────────────────────────────────────

  #checkHubAccess(hubId, userId, userRoles) {
    if (!this.hubService.canAccessHub(hubId, userId, userRoles)) {
      throw new ServiceError('FORBIDDEN', 'Cannot access hub')
    }
  }

  #checkChannelAccess(channelId, userId) {
    if (!this.channelService.isMember(channelId, userId)) {
      throw new ServiceError('FORBIDDEN', 'Not a member of this channel')
    }
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  /**
   * Pin a document from a mesh repo to a hub or channel.
   * Exactly one of `hubId` / `channelId` must be provided.
   * @returns {object} pinned document record
   */
  pinDocument({ userId, userRoles = [], hubId = null, channelId = null, repo, path, title }) {
    if (!hubId && !channelId) throw new ServiceError('BAD_REQUEST', 'hub_id or channel_id required')
    if (!repo?.trim())   throw new ServiceError('BAD_REQUEST', 'repo required')
    if (!path?.trim())   throw new ServiceError('BAD_REQUEST', 'path required')
    if (!title?.trim())  throw new ServiceError('BAD_REQUEST', 'title required')

    if (hubId)      this.#checkHubAccess(hubId, userId, userRoles)
    if (channelId)  this.#checkChannelAccess(channelId, userId)

    const docId    = newId('doc')
    const pinnedAt = this.nowFn()
    this.documentRepo.pin({ docId, hubId, channelId, repo: repo.trim(), path: path.trim(), title: title.trim(), pinnedBy: userId, pinnedAt })
    return { doc_id: docId, hub_id: hubId ?? null, channel_id: channelId ?? null, repo: repo.trim(), path: path.trim(), title: title.trim(), last_commit: null, last_updated_at: null, pinned_by: userId, pinned_at: pinnedAt }
  }

  /**
   * Look up a document by ID without access-checking (for internal use by handlers).
   * @returns {object|null}
   */
  getDoc(docId) {
    return this.documentRepo.findById({ docId })
  }

  /**
   * Remove a pinned document. The caller must have access to the hub/channel it's pinned to.
   */
  unpinDocument({ docId, userId, userRoles = [] }) {
    const doc = this.documentRepo.findById({ docId })
    if (!doc) throw new ServiceError('NOT_FOUND', 'Document not found')
    if (doc.hub_id)      this.#checkHubAccess(doc.hub_id, userId, userRoles)
    if (doc.channel_id)  this.#checkChannelAccess(doc.channel_id, userId)
    this.documentRepo.unpin({ docId })
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /**
   * List pinned documents for a hub or channel.
   * Exactly one of `hubId` / `channelId` must be provided.
   * @returns {Array<object>}
   */
  listDocuments({ hubId = null, channelId = null, userId, userRoles = [] }) {
    if (!hubId && !channelId) throw new ServiceError('BAD_REQUEST', 'hub_id or channel_id required')
    if (hubId)      this.#checkHubAccess(hubId, userId, userRoles)
    if (channelId)  this.#checkChannelAccess(channelId, userId)
    return hubId
      ? this.documentRepo.listByHub({ hubId })
      : this.documentRepo.listByChannel({ channelId })
  }

  /**
   * Fetch the raw markdown content of a pinned document from mesh.
   * @returns {Promise<{ content: string, commit: string|null }>}
   */
  async getDocumentContent({ docId, userId, userRoles = [] }) {
    const doc = this.documentRepo.findById({ docId })
    if (!doc) throw new ServiceError('NOT_FOUND', 'Document not found')
    if (!this.meshGitAdapter) throw new ServiceError('SERVICE_UNAVAILABLE', 'Mesh git integration is not configured')

    if (doc.hub_id)      this.#checkHubAccess(doc.hub_id, userId, userRoles)
    if (doc.channel_id)  this.#checkChannelAccess(doc.channel_id, userId)

    const [content, commit] = await Promise.all([
      this.meshGitAdapter.fetchRawFile(doc.repo, doc.path),
      this.meshGitAdapter.getLatestCommit(doc.repo, doc.path),
    ])
    return { content, commit }
  }
}
