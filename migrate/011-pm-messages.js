export function run(db) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'`)
  } catch (e) {
    if (!e.message.includes('duplicate column name')) throw e
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN content_json TEXT`)
  } catch (e) {
    if (!e.message.includes('duplicate column name')) throw e
  }
}
