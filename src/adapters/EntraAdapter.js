/**
 * EntraAdapter — I/O adapter for Azure Entra OIDC.
 * Wraps network calls (token exchange, JWKS fetch) so AuthService stays pure.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { buildTokenRequestBody, buildTokenRefreshBody, extractClaims } from '../core/entraOidc.js'

export class EntraAdapter {
  constructor({ tenantId, clientId, clientSecret, redirectUri }) {
    this.tenantId = tenantId
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.redirectUri = redirectUri
    this._jwks = null
  }

  get #jwks() {
    if (!this._jwks) {
      this._jwks = createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`)
      )
    }
    return this._jwks
  }

  get #tokenEndpoint() {
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`
  }

  /**
   * Exchange an authorization code for tokens.
   * @returns {{ id_token, access_token, refresh_token }}
   */
  async fetchTokens(code) {
    const body = buildTokenRequestBody({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      code,
      redirectUri: this.redirectUri,
    })
    const res = await fetch(this.#tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Entra token exchange failed: ${res.status} — ${text}`)
    }
    return res.json()
  }

  /**
   * Verify an ID token JWT and return extracted claims.
   * Throws if the token is invalid, expired, or the nonce doesn't match.
   * @param {string} idToken
   * @param {string} nonce   expected nonce from the state cookie
   * @returns {{ oid, email, upn, displayName, nonce }}
   */
  async verifyIdToken(idToken, nonce) {
    const { payload } = await jwtVerify(idToken, this.#jwks, {
      issuer: `https://login.microsoftonline.com/${this.tenantId}/v2.0`,
      audience: this.clientId,
    })
    const claims = extractClaims(payload)
    if (nonce && claims.nonce !== nonce) {
      throw new Error('ID token nonce mismatch — possible replay attack')
    }
    return claims
  }

  /**
   * Use a refresh token to get a fresh access token.
   * @param {string} refreshToken
   * @param {string[]} extraScopes
   * @returns {{ access_token, refresh_token, expires_in }}
   */
  async refreshAccessToken(refreshToken, extraScopes = []) {
    const body = buildTokenRefreshBody({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken,
      extraScopes,
    })
    const res = await fetch(this.#tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Entra token refresh failed: ${res.status} — ${text}`)
    }
    return res.json()
  }
}
