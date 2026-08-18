export function run(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meeting_segments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id     TEXT NOT NULL REFERENCES channels(channel_id),
      name           TEXT NOT NULL,
      divider_msg_id TEXT,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_segments_channel ON meeting_segments(channel_id);
  `)
}
