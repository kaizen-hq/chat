export class InMemoryDocumentRepository {
  constructor() {
    this._docs = new Map()  // docId → doc record
  }

  pin({ docId, hubId, channelId, repo, path, title, lastCommit, lastUpdatedAt, pinnedBy, pinnedAt }) {
    this._docs.set(docId, {
      doc_id: docId,
      hub_id: hubId ?? null,
      channel_id: channelId ?? null,
      repo,
      path,
      title,
      last_commit: lastCommit ?? null,
      last_updated_at: lastUpdatedAt ?? null,
      pinned_by: pinnedBy,
      pinned_at: pinnedAt,
    })
  }

  unpin({ docId }) {
    this._docs.delete(docId)
  }

  findById({ docId }) {
    return this._docs.get(docId) ?? null
  }

  listByHub({ hubId }) {
    return [...this._docs.values()]
      .filter(d => d.hub_id === hubId)
      .sort((a, b) => b.pinned_at.localeCompare(a.pinned_at))
  }

  listByChannel({ channelId }) {
    return [...this._docs.values()]
      .filter(d => d.channel_id === channelId)
      .sort((a, b) => b.pinned_at.localeCompare(a.pinned_at))
  }

  updateCommit({ docId, lastCommit, lastUpdatedAt }) {
    const doc = this._docs.get(docId)
    if (doc) {
      doc.last_commit = lastCommit
      doc.last_updated_at = lastUpdatedAt
    }
  }
}
