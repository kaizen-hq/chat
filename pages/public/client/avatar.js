/**
 * avatar.js — deterministic letter avatars.
 *
 * Default: initials derived from display name, color from a palette keyed by user_id.
 * Custom: user can override chars (up to 2) and pick a palette color via settings.
 */

// 12 accessible background / foreground pairs
export const PALETTE = [
  { bg: '#5865F2', fg: '#ffffff' },  // indigo
  { bg: '#3BA55D', fg: '#ffffff' },  // green
  { bg: '#ED4245', fg: '#ffffff' },  // red
  { bg: '#FAA61A', fg: '#ffffff' },  // amber
  { bg: '#9B59B6', fg: '#ffffff' },  // purple
  { bg: '#1ABC9C', fg: '#ffffff' },  // teal
  { bg: '#E67E22', fg: '#ffffff' },  // orange
  { bg: '#E91E8C', fg: '#ffffff' },  // pink
  { bg: '#2196F3', fg: '#ffffff' },  // blue
  { bg: '#607D8B', fg: '#ffffff' },  // slate
  { bg: '#795548', fg: '#ffffff' },  // brown
  { bg: '#009688', fg: '#ffffff' },  // cyan-teal
]

/**
 * Deterministically map a user_id string to a palette entry.
 * @param {string} userId
 * @returns {{ bg: string, fg: string }}
 */
export function colorFromId(userId = '') {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(31, h) + userId.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(h) % PALETTE.length]
}

/**
 * Derive initials from a display name or handle.
 * "Joey Guerra" → "JG", "alice" → "AL", "" → "?"
 * @param {string} displayName
 * @param {string} [handle]
 * @returns {string}  1–2 uppercase characters
 */
export function initials(displayName = '', handle = '') {
  const src = displayName.trim() || handle.trim()
  if (!src) return '?'
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

/**
 * Return an HTML string for an avatar circle.
 * @param {{ userId: string, displayName?: string, handle?: string,
 *            avatarChars?: string, avatarColor?: number, size?: number }} opts
 * @returns {string} HTML
 */
export function renderAvatar({ userId = '', displayName = '', handle = '', avatarChars = null, avatarColor = null, size = 32 } = {}) {
  const chars  = (avatarChars?.trim().slice(0, 2).toUpperCase()) || initials(displayName, handle)
  const colors = (avatarColor != null && PALETTE[avatarColor]) ? PALETTE[avatarColor] : colorFromId(userId)
  const fs     = Math.round(size * 0.4)
  return `<span class="avatar" data-user-id="${userId}" style="width:${size}px;height:${size}px;background:${colors.bg};color:${colors.fg};font-size:${fs}px;" aria-label="${chars}" title="${displayName || handle || userId}">${chars}</span>`
}
