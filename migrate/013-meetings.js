export function run(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meeting_meta (
      channel_id              TEXT PRIMARY KEY REFERENCES channels(channel_id),
      scheduled_at            TEXT,
      ended_at                TEXT,
      parent_channel_id       TEXT REFERENCES channels(channel_id),
      continuation_channel_id TEXT REFERENCES channels(channel_id),
      calendar_event_id       TEXT
    );
  `)
}
