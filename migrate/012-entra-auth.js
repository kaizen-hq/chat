export function run(db) {
  // users — Entra identity columns
  for (const sql of [
    `ALTER TABLE users ADD COLUMN entra_oid TEXT UNIQUE`,
    `ALTER TABLE users ADD COLUMN email TEXT`,
    `ALTER TABLE users ADD COLUMN upn TEXT`,
    // 0 = Entra-only; 1 = local password allowed
    `ALTER TABLE users ADD COLUMN allow_local_auth INTEGER NOT NULL DEFAULT 0`,
    // one-time activation token hash used to bind the first Entra admin
    `ALTER TABLE users ADD COLUMN activation_token_hash TEXT`,
  ]) {
    try { db.exec(sql) } catch (e) { if (!e.message.includes('duplicate column name')) throw e }
  }

  // existing users keep local auth so no one is locked out on rollout
  db.exec(`UPDATE users SET allow_local_auth = 1 WHERE allow_local_auth = 0 AND password_hash IS NOT NULL`)

  // sessions — delegated Graph API tokens (encrypted at rest when SESSION_ENCRYPTION_KEY is set)
  for (const sql of [
    `ALTER TABLE sessions ADD COLUMN access_token TEXT`,
    `ALTER TABLE sessions ADD COLUMN refresh_token TEXT`,
  ]) {
    try { db.exec(sql) } catch (e) { if (!e.message.includes('duplicate column name')) throw e }
  }
}
