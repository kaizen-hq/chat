export function run(db) {
  try { db.exec('ALTER TABLE messages ADD COLUMN reply_to TEXT') } catch { /* already exists */ }
}
