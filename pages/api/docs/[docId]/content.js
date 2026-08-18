/**
 * GET /api/docs/:docId/content
 *
 * Server-side proxy: fetches markdown content from mesh git and returns it.
 * Avoids CORS issues on the client. Auth required.
 */
import { sessionFromRequest, documentService } from '../../../../src/context.js'

export async function GET(req, params) {
  const session = sessionFromRequest(req)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { docId } = params

  try {
    const { content, commit } = await documentService.getDocumentContent({
      docId,
      userId: session.user.user_id,
      userRoles: session.user.roles ?? [],
    })
    return Response.json({ content, commit })
  } catch (err) {
    if (err?.code === 'NOT_FOUND') return new Response('Not found', { status: 404 })
    if (err?.code === 'FORBIDDEN') return new Response('Forbidden', { status: 403 })
    if (err?.code === 'SERVICE_UNAVAILABLE') return new Response('Mesh git not configured', { status: 503 })
    return new Response('Internal error', { status: 500 })
  }
}
