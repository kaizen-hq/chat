export class SqliteDocumentRepository {
  constructor({ db }) {
    this.db = db
  }

  pin({ docId, hubId, channelId, repo, path, title, lastCommit, lastUpdatedAt, pinnedBy, pinnedAt }) {
    this.db.prepare(
      `INSERT INTO pinned_documents
         (doc_id, hub_id, channel_id, repo, path, title, last_commit, last_updated_at, pinned_by, pinned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(docId, hubId ?? null, channelId ?? null, repo, path, title, lastCommit ?? null, lastUpdatedAt ?? null, pinnedBy, pinnedAt)
  }

  unpin({ docId }) {
    this.db.prepare('DELETE FROM pinned_documents WHERE doc_id = ?').run(docId)
  }

  findById({ docId }) {
    return this.db.prepare('SELECT * FROM pinned_documents WHERE doc_id = ?').get(docId) ?? null
  }

  listByHub({ hubId }) {
    return this.db.prepare(
      `SELECT * FROM pinned_documents WHERE hub_id = ? ORDER BY pinned_at DESC`
    ).all(hubId)
  }

  listByChannel({ channelId }) {
    return this.db.prepare(
      `SELECT * FROM pinned_documents WHERE channel_id = ? ORDER BY pinned_at DESC`
    ).all(channelId)
  }

  updateCommit({ docId, lastCommit, lastUpdatedAt }) {
    this.db.prepare(
      'UPDATE pinned_documents SET last_commit = ?, last_updated_at = ? WHERE doc_id = ?'
    ).run(lastCommit, lastUpdatedAt, docId)
  }
}
