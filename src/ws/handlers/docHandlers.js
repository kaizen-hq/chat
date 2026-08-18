/**
 * Pinned document WS handlers.
 *
 * Any hub/channel member can pin or unpin documents from mesh git repos.
 */

export function handleDocPin(ws, msg, ctx) {
  const { auth, documentService, sendWs, publishChannel } = ctx
  const user = auth.getUser(ws.data.userId)
  const { hub_id, channel_id, repo, path, title } = msg.body || {}
  const doc = documentService.pinDocument({
    userId: ws.data.userId,
    userRoles: user?.roles || [],
    hubId: hub_id ?? null,
    channelId: channel_id ?? null,
    repo,
    path,
    title,
  })
  sendWs(ws, { t: 'doc.pinned', reply_to: msg.id, ok: true, body: { doc } })
  // Notify the channel or hub audience
  if (channel_id) {
    publishChannel(channel_id, { t: 'doc.pinned', ok: true, body: { doc } })
  }
}

export function handleDocUnpin(ws, msg, ctx) {
  const { auth, documentService, sendWs, publishChannel } = ctx
  const user = auth.getUser(ws.data.userId)
  const { doc_id } = msg.body || {}

  // Fetch the doc before unpinning so we know which channel to notify
  const existing = documentService.getDoc(doc_id)

  documentService.unpinDocument({
    docId: doc_id,
    userId: ws.data.userId,
    userRoles: user?.roles || [],
  })
  sendWs(ws, { t: 'doc.unpinned', reply_to: msg.id, ok: true, body: { doc_id } })
  if (existing?.channel_id) {
    publishChannel(existing.channel_id, { t: 'doc.unpinned', ok: true, body: { doc_id } })
  }
}

export function handleDocList(ws, msg, ctx) {
  const { auth, documentService, sendWs } = ctx
  const user = auth.getUser(ws.data.userId)
  const { hub_id, channel_id } = msg.body || {}
  const docs = documentService.listDocuments({
    hubId: hub_id ?? null,
    channelId: channel_id ?? null,
    userId: ws.data.userId,
    userRoles: user?.roles || [],
  })
  sendWs(ws, { t: 'doc.list_result', reply_to: msg.id, ok: true, body: { docs, hub_id, channel_id } })
}
