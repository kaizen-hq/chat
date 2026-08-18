export function run(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pinned_documents (
      doc_id          TEXT PRIMARY KEY,
      hub_id          TEXT REFERENCES hubs(hub_id),
      channel_id      TEXT REFERENCES channels(channel_id),
      repo            TEXT NOT NULL,
      path            TEXT NOT NULL,
      title           TEXT NOT NULL,
      last_commit     TEXT,
      last_updated_at TEXT,
      pinned_by       TEXT NOT NULL REFERENCES users(user_id),
      pinned_at       TEXT NOT NULL,
      CHECK (hub_id IS NOT NULL OR channel_id IS NOT NULL)
    );
  `)
}
