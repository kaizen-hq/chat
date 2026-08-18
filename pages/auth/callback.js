/**
 * GET /auth/callback — receive the authorization code from Entra, exchange it
 * for tokens, verify the ID token, and create a session.
 */
import { p } from '../../src/config.js'
import { auth, entraAdapter, sessionCookie } from '../../src/context.js'
import { parseStateCookie } from '../../src/core/entraOidc.js'
import { encryptToken } from '../../src/util/tokenCipher.js'

const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY
  ? (await import('../../src/util/tokenCipher.js')).loadEncryptionKey(process.env.SESSION_ENCRYPTION_KEY)
  : null

export async function GET(req) {
  if (!entraAdapter) {
    return new Response('Entra SSO is not configured on this server.', { status: 404 })
  }

  const url = new URL(req.url)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    const desc = url.searchParams.get('error_description') ?? error
    return renderError(`Entra login failed: ${desc}`)
  }
  if (!code || !state) return renderError('Missing code or state parameter')

  // Verify + unpack the state cookie
  const cookie = req.headers.get('cookie') ?? ''
  const rawCookie = cookie.match(/(?:^|;\s*)oidc_state=([^;]+)/)?.[1]
  const cookieValue = rawCookie ? decodeURIComponent(rawCookie) : null
  const parsed = parseStateCookie({ cookieValue, state, secret: entraAdapter.clientSecret })
  if (!parsed) return renderError('State verification failed — possible CSRF attempt')

  const { nonce, activate } = parsed

  try {
    // Exchange code for tokens
    const tokens = await entraAdapter.fetchTokens(code)
    const claims = await entraAdapter.verifyIdToken(tokens.id_token, nonce)

    const accessToken  = tokens.access_token  ? encryptToken(tokens.access_token,  ENCRYPTION_KEY) : null
    const refreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token, ENCRYPTION_KEY) : null

    let result
    if (activate) {
      result = await auth.activateEntraAdmin({ activationToken: activate, ...claims, accessToken, refreshToken })
    } else {
      result = await auth.signInWithEntra({ ...claims, accessToken, refreshToken })
    }

    // Clear the state cookie and set the session cookie
    const headers = new Headers({
      Location: p('/'),
    })
    headers.append('Set-Cookie', sessionCookie(result.sessionToken))
    headers.append('Set-Cookie', 'oidc_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    return new Response(null, { status: 302, headers })
  } catch (err) {
    console.error('[auth/callback]', err)
    return renderError(err.message ?? 'Authentication failed')
  }
}

function renderError(message) {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return new Response(
    `<!doctype html><html><body><p style="color:red">${safe}</p><a href="/login">Back to login</a></body></html>`,
    { status: 400, headers: { 'Content-Type': 'text/html' } }
  )
}
