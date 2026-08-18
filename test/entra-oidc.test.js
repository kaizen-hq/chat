import { test, expect } from 'bun:test'
import {
  generateState, generateNonce,
  buildAuthUrl, buildTokenRequestBody,
  extractClaims,
  buildStateCookieValue, parseStateCookie,
} from '../src/core/entraOidc.js'

const SECRET = 'test-secret-for-hmac'
const TENANT = 'my-tenant-id'
const CLIENT = 'my-client-id'
const REDIRECT = 'https://chat.example.com/auth/callback'

// ── generateState / generateNonce ─────────────────────────────────────────────

test('generateState returns 32-char hex string', () => {
  const s = generateState()
  expect(s).toMatch(/^[0-9a-f]{32}$/)
})

test('generateNonce returns 32-char hex string', () => {
  expect(generateNonce()).toMatch(/^[0-9a-f]{32}$/)
})

test('generateState produces different values each call', () => {
  expect(generateState()).not.toBe(generateState())
})

// ── buildAuthUrl ──────────────────────────────────────────────────────────────

test('buildAuthUrl contains tenantId and clientId', () => {
  const url = buildAuthUrl({ tenantId: TENANT, clientId: CLIENT, redirectUri: REDIRECT, state: 'st', nonce: 'nc' })
  expect(url).toContain(TENANT)
  expect(url).toContain(`client_id=${CLIENT}`)
})

test('buildAuthUrl includes openid and email scopes', () => {
  const url = buildAuthUrl({ tenantId: TENANT, clientId: CLIENT, redirectUri: REDIRECT, state: 'st', nonce: 'nc' })
  expect(url).toContain('openid')
  expect(url).toContain('email')
})

test('buildAuthUrl includes extra scopes', () => {
  const url = buildAuthUrl({ tenantId: TENANT, clientId: CLIENT, redirectUri: REDIRECT, state: 'st', nonce: 'nc', extraScopes: ['Calendars.ReadWrite'] })
  expect(url).toContain('Calendars.ReadWrite')
})

test('buildAuthUrl encodes state and nonce', () => {
  const url = buildAuthUrl({ tenantId: TENANT, clientId: CLIENT, redirectUri: REDIRECT, state: 'mystate', nonce: 'mynonce' })
  expect(url).toContain('state=mystate')
  expect(url).toContain('nonce=mynonce')
})

// ── buildTokenRequestBody ─────────────────────────────────────────────────────

test('buildTokenRequestBody includes grant_type authorization_code', () => {
  const body = buildTokenRequestBody({ clientId: CLIENT, clientSecret: 'sec', code: 'code123', redirectUri: REDIRECT })
  const params = new URLSearchParams(body)
  expect(params.get('grant_type')).toBe('authorization_code')
  expect(params.get('code')).toBe('code123')
  expect(params.get('client_id')).toBe(CLIENT)
})

// ── extractClaims ─────────────────────────────────────────────────────────────

test('extractClaims maps oid, email, upn, displayName, nonce', () => {
  const payload = {
    oid: 'abc-123',
    email: 'joey@example.com',
    preferred_username: 'joey@example.com',
    name: 'Joey Guerra',
    nonce: 'nc123',
  }
  const claims = extractClaims(payload)
  expect(claims.oid).toBe('abc-123')
  expect(claims.email).toBe('joey@example.com')
  expect(claims.upn).toBe('joey@example.com')
  expect(claims.displayName).toBe('Joey Guerra')
  expect(claims.nonce).toBe('nc123')
})

test('extractClaims handles missing optional fields gracefully', () => {
  const claims = extractClaims({ oid: 'x' })
  expect(claims.oid).toBe('x')
  expect(claims.email).toBeNull()
  expect(claims.upn).toBeNull()
  expect(claims.displayName).toBeNull()
  expect(claims.nonce).toBeNull()
})

// ── state cookie ──────────────────────────────────────────────────────────────

test('buildStateCookieValue + parseStateCookie roundtrip returns nonce', () => {
  const state = 'aabbccdd'
  const nonce = 'eeff0011'
  const cookie = buildStateCookieValue({ state, nonce, secret: SECRET })
  const result = parseStateCookie({ cookieValue: cookie, state, secret: SECRET })
  expect(result).not.toBeNull()
  expect(result.nonce).toBe(nonce)
  expect(result.activate).toBeNull()
})

test('parseStateCookie carries activate token through', () => {
  const state = 'aabbccdd'
  const nonce = 'eeff0011'
  const activate = 'myactivationtoken'
  const cookie = buildStateCookieValue({ state, nonce, activate, secret: SECRET })
  const result = parseStateCookie({ cookieValue: cookie, state, secret: SECRET })
  expect(result.activate).toBe(activate)
})

test('parseStateCookie returns null for wrong state', () => {
  const cookie = buildStateCookieValue({ state: 'real', nonce: 'nc', secret: SECRET })
  expect(parseStateCookie({ cookieValue: cookie, state: 'forged', secret: SECRET })).toBeNull()
})

test('parseStateCookie returns null for tampered signature', () => {
  const cookie = buildStateCookieValue({ state: 'st', nonce: 'nc', secret: SECRET })
  const tampered = cookie.slice(0, -4) + '0000'
  expect(parseStateCookie({ cookieValue: tampered, state: 'st', secret: SECRET })).toBeNull()
})

test('parseStateCookie returns null for missing cookie', () => {
  expect(parseStateCookie({ cookieValue: null, state: 'st', secret: SECRET })).toBeNull()
  expect(parseStateCookie({ cookieValue: '', state: 'st', secret: SECRET })).toBeNull()
})
