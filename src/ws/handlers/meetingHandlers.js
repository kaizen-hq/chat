/**
 * Meeting WS handlers.
 *
 * Meetings are private, hub-free channels (kind='meeting'). All messages —
 * including across continuations — live in the single root meeting channel.
 * Continuations are segments recorded in meeting_segments; a continuation_divider
 * message is inserted into the channel to serve as the scroll anchor.
 */
import { buildMeetingEvent, buildMeetingClosedEvent } from '../../core/meeting.js'

export function handleMeetingCreate(ws, msg, ctx) {
  const { meetingService, sendWs, broadcastToChannelAudience, pushService, server } = ctx
  const { name, scheduled_at, attendee_emails, attendee_user_ids } = msg.body || {}
  const meeting = meetingService.createMeeting({
    name, scheduledAt: scheduled_at ?? null,
    userId: ws.data.userId,
    attendeeUserIds: Array.isArray(attendee_user_ids) ? attendee_user_ids : [],
    attendeeEmails:  Array.isArray(attendee_emails)   ? attendee_emails   : [],
  })
  const event = buildMeetingEvent(meeting)
  sendWs(ws, { t: 'meeting.created', reply_to: msg.id, ok: true, body: { meeting: event } })
  broadcastToChannelAudience(meeting.channel_id, { t: 'meeting.created', ok: true, body: { meeting: event } }, ws)

  // Notify each invited attendee (excluding the creator)
  const members = meetingService.getMeetingMembers({ channelId: meeting.channel_id })
  const invitedUserIds = members.map(m => m.user_id).filter(id => id !== ws.data.userId)
  const invitePayload = {
    v: 1, server_ts: Date.now(), t: 'meeting.invited', ok: true,
    body: { meeting: event, invited_by: ws.data.userId },
  }
  for (const userId of invitedUserIds) {
    server?.publish(`user:${userId}`, JSON.stringify(invitePayload))
    pushService?.sendToUser({
      userId,
      title: `Meeting invite: ${meeting.name}`,
      body: `${ws.data.displayName ?? 'Someone'} invited you to a meeting`,
      url: `/channels/${meeting.channel_id}`,
      channelId: meeting.channel_id,
    })
  }
}

export function handleMeetingClose(ws, msg, ctx) {
  const { meetingService, sendWs, broadcastToChannelAudience } = ctx
  const { channel_id } = msg.body || {}
  const { meeting, closedSegment } = meetingService.closeMeeting({ channelId: channel_id, userId: ws.data.userId })
  const closedEvent = buildMeetingClosedEvent(meeting, closedSegment)
  sendWs(ws, { t: 'meeting.closed', reply_to: msg.id, ok: true, body: closedEvent })
  broadcastToChannelAudience(channel_id, { t: 'meeting.closed', ok: true, body: closedEvent }, ws)
}

export function handleMeetingContinue(ws, msg, ctx) {
  const { meetingService, messageService, sendWs, broadcastToChannelAudience } = ctx
  const { channel_id, name } = msg.body || {}

  // Insert a continuation_divider message first — its msg_id anchors the segment
  // boundary so the client can scroll to it.
  const segmentName = name?.trim() || ''
  const dividerMsg = messageService.sendMessage({
    channelId: channel_id,
    userId: ws.data.userId,
    text: segmentName || 'Continued',
    kind: 'continuation_divider',
  })

  const { segment, closedSegment } = meetingService.continueMeeting({
    channelId: channel_id, name: segmentName, userId: ws.data.userId,
    dividerMsgId: dividerMsg.msg_id,
  })

  const payload = { channel_id, segment, closed_segment: closedSegment ?? null, divider_msg: dividerMsg }
  sendWs(ws, { t: 'meeting.continued', reply_to: msg.id, ok: true, body: payload })
  broadcastToChannelAudience(channel_id, { t: 'meeting.continued', ok: true, body: payload }, ws)

  // Also broadcast the divider message itself so other members see it in real-time
  broadcastToChannelAudience(channel_id, {
    t: 'msg.event', ok: true,
    body: { ...dividerMsg, channel_id },
  }, ws)
}

export async function handleMeetingSchedule(ws, msg, ctx) {
  const { auth, meetingService, sendWs, broadcastToChannelAudience } = ctx
  const { channel_id, scheduled_at } = msg.body || {}

  const tokens = ws.data.sessionId ? auth.getSessionTokens({ sessionId: ws.data.sessionId }) : null

  const meeting = await meetingService.scheduleMeeting({
    channelId: channel_id, scheduledAt: scheduled_at,
    userId: ws.data.userId,
    accessToken: tokens?.accessToken ?? null,
  })
  const event = buildMeetingEvent(meeting)
  sendWs(ws, { t: 'meeting.scheduled', reply_to: msg.id, ok: true, body: { meeting: event } })
  broadcastToChannelAudience(channel_id, { t: 'meeting.scheduled', ok: true, body: { meeting: event } }, ws)
}

export function handleMeetingList(ws, msg, ctx) {
  const { meetingService, sendWs } = ctx
  const meetings = meetingService.listMeetings({ userId: ws.data.userId })
  sendWs(ws, { t: 'meeting.list_result', reply_to: msg.id, ok: true, body: { meetings: meetings.map(buildMeetingEvent) } })
}

export function handleMeetingInvite(ws, msg, ctx) {
  const { meetingService, sendWs, broadcastToChannelAudience, pushService, server } = ctx
  const { channel_id, user_ids } = msg.body || {}
  const { added, meeting } = meetingService.inviteMembers({
    channelId: channel_id,
    userId: ws.data.userId,
    inviteeUserIds: Array.isArray(user_ids) ? user_ids : [],
  })

  sendWs(ws, { t: 'meeting.invite_result', reply_to: msg.id, ok: true, body: { channel_id, added } })

  if (added.length === 0) return

  broadcastToChannelAudience(channel_id, { t: 'meeting.members_added', ok: true, body: { channel_id, user_ids: added } }, ws)

  const event = meeting ? buildMeetingEvent(meeting) : null
  const invitePayload = {
    v: 1, server_ts: Date.now(), t: 'meeting.invited', ok: true,
    body: { meeting: event, invited_by: ws.data.userId },
  }
  for (const userId of added) {
    server?.publish(`user:${userId}`, JSON.stringify(invitePayload))
    pushService?.sendToUser({
      userId,
      title: `Meeting invite: ${meeting?.name ?? 'a meeting'}`,
      body: `${ws.data.displayName ?? 'Someone'} invited you to a meeting`,
      url: `/channels/${channel_id}`,
      channelId: channel_id,
    })
  }
}
