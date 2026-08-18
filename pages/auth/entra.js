/**
 * GET /auth/entra — redirect the user to the Azure Entra authorization endpoint.
 *
 * Query params:
 *   ?activate=<token>  (optional) one-time admin activation token from the bootstrap flow
 */
import { p } from '../../src/config.js'
import { entraAdapter, sessionFromRequest } from '../../src/context.js'
import { generateState, generateNonce, buildAuthUrl, buildStateCookieValue } from '../../src/core/entraOidc.js'

export async function GET(req) {
  if (!entraAdapter) {
    return new Response('Entra SSO is not configured on this server.', { status: 404 })
  }

  // If already logged in, skip the flow
  const session = sessionFromRequest(req)
  if (session) return Response.redirect(p('/'), 302)

  const url = new URL(req.url)
  const activate = url.searchParams.get('activate') ?? ''

  const state = generateState()
  const nonce = generateNonce()

  const authUrl = buildAuthUrl({
    tenantId: entraAdapter.tenantId,
    clientId: entraAdapter.clientId,
    redirectUri: entraAdapter.redirectUri,
    state,
    nonce,
    extraScopes: process.env.GRAPH_CALENDAR_SCOPE ? [process.env.GRAPH_CALENDAR_SCOPE] : [],
  })

  // Pack state + nonce + activate into a short-lived signed cookie
  const cookieValue = buildStateCookieValue({ state, nonce, activate, secret: entraAdapter.clientSecret })
  const stateCookie = `oidc_state=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl, 'Set-Cookie': stateCookie },
  })
}
