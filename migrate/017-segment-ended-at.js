export function run(db) {
  db.exec(`
    ALTER TABLE meeting_segments ADD COLUMN ended_at INTEGER;
  `)
}
