/**
 * entraOidc.js — pure functions for the Azure Entra OIDC authorization code flow.
 * No I/O. Network calls (JWKS fetch, token exchange) live in EntraAdapter.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'crypto'

// ── Random values ─────────────────────────────────────────────────────────────

export function generateState() { return randomBytes(16).toString('hex') }
export function generateNonce() { return randomBytes(16).toString('hex') }

// ── Authorization URL ─────────────────────────────────────────────────────────

/**
 * Build the Entra v2 authorization URL to redirect the user to.
 * @param {{ tenantId, clientId, redirectUri, state, nonce, extraScopes? }} opts
 */
export function buildAuthUrl({ tenantId, clientId, redirectUri, state, nonce, extraScopes = [] }) {
  const scopes = ['openid', 'profile', 'email', 'offline_access', ...extraScopes]
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: [...new Set(scopes)].join(' '),
    state,
    nonce,
  })
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params}`
}

// ── Token request bodies ──────────────────────────────────────────────────────

export function buildTokenRequestBody({ clientId, clientSecret, code, redirectUri }) {
  return new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString()
}

export function buildTokenRefreshBody({ clientId, clientSecret, refreshToken, extraScopes = [] }) {
  const scopes = ['openid', 'profile', 'email', 'offline_access', ...extraScopes]
  return new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: [...new Set(scopes)].join(' '),
  }).toString()
}

// ── Claims extraction ─────────────────────────────────────────────────────────

/**
 * Extract the fields we care about from a verified JWT payload.
 * @param {object} payload  decoded JWT payload from jose
 * @returns {{ oid, email, upn, displayName, nonce }}
 */
export function extractClaims(payload) {
  return {
    oid:         payload.oid ?? null,
    email:       payload.email ?? null,
    upn:         payload.preferred_username ?? null,
    displayName: payload.name ?? null,
    nonce:       payload.nonce ?? null,
  }
}

// ── State cookie (CSRF protection) ───────────────────────────────────────────
//
// The state cookie encodes: state · nonce · activate_token · hmac
// '·' is the ASCII middle dot (U+00B7), which doesn't appear in hex strings.
//
// `activate` is the one-time admin activation token, or empty for normal logins.

const SEP = '\u00b7'

/**
 * Build a signed state cookie value.
 * @param {{ state, nonce, activate?, secret }} opts
 */
export function buildStateCookieValue({ state, nonce, activate = '', secret }) {
  const raw = [state, nonce, activate].join(SEP)
  const sig = createHmac('sha256', secret).update(raw).digest('hex')
  return [raw, sig].join(SEP)
}

/**
 * Verify the state cookie value and return { nonce, activate } or null.
 * Timing-safe HMAC comparison.
 * @param {{ cookieValue, state, secret }} opts
 */
export function parseStateCookie({ cookieValue, state, secret }) {
  if (!cookieValue) return null
  const parts = cookieValue.split(SEP)
  if (parts.length !== 4) return null
  const [cookieState, nonce, activate, sig] = parts
  const raw = [cookieState, nonce, activate].join(SEP)
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  try {
    const sigBuf = Buffer.from(sig.padEnd(64, '0').slice(0, 64), 'hex')
    const expBuf = Buffer.from(expected, 'hex')
    if (!timingSafeEqual(sigBuf, expBuf)) return null
  } catch { return null }
  if (cookieState !== state) return null
  return { nonce, activate: activate || null }
}
