export class InMemoryMeetingRepository {
  constructor() {
    this._channels  = new Map()  // channelId → channel record
    this._metas     = new Map()  // channelId → meeting_meta record
    this._members   = new Map()  // channelId → Map<userId, { user_id, role }>
    this._segments  = new Map()  // channelId → segment[]
    this._nextSegId = 1
  }

  insertMeeting({ channelId, name, createdByUserId, scheduledAt = null, parentChannelId = null, now }) {
    this._channels.set(channelId, {
      channel_id: channelId, hub_id: null, kind: 'meeting', name,
      visibility: 'private', created_by_user_id: createdByUserId,
      created_at: now, deleted_at: null,
    })
    this._metas.set(channelId, {
      channel_id: channelId, scheduled_at: scheduledAt ?? null,
      ended_at: null, parent_channel_id: parentChannelId ?? null,
      calendar_event_id: null,
    })
    this._members.set(channelId, new Map())
    this._segments.set(channelId, [])
  }

  addMember({ channelId, userId, role = 'member' }) {
    if (!this._members.has(channelId)) this._members.set(channelId, new Map())
    this._members.get(channelId).set(userId, { user_id: userId, role })
  }

  getMembers({ channelId }) {
    return [...(this._members.get(channelId) ?? new Map()).values()]
  }

  listForUser({ userId }) {
    const result = []
    for (const [channelId, memberMap] of this._members) {
      if (memberMap.has(userId)) {
        const meeting = this.findById({ channelId })
        // Only return root meetings (no parent_channel_id)
        if (meeting && !meeting.parent_channel_id) {
          result.push({ ...meeting, segments: this.listSegments({ channelId }) })
        }
      }
    }
    return result.sort((a, b) => b.created_at - a.created_at)
  }

  findById({ channelId }) {
    const ch = this._channels.get(channelId)
    if (!ch || ch.deleted_at) return null
    const meta = this._metas.get(channelId) ?? {}
    return { ...ch, ...meta }
  }

  closeMeeting({ channelId, now }) {
    const meta = this._metas.get(channelId)
    if (meta) meta.ended_at = now
  }

  insertSegment({ channelId, name, dividerMsgId, now }) {
    if (!this._segments.has(channelId)) this._segments.set(channelId, [])
    const seg = { id: this._nextSegId++, channel_id: channelId, name, divider_msg_id: dividerMsgId ?? null, created_at: now, ended_at: null }
    this._segments.get(channelId).push(seg)
    return seg
  }

  closeSegment({ id, now }) {
    for (const segs of this._segments.values()) {
      const seg = segs.find(s => s.id === id)
      if (seg) { seg.ended_at = now; return }
    }
  }

  listSegments({ channelId }) {
    return [...(this._segments.get(channelId) ?? [])]
  }

  setScheduledAt({ channelId, scheduledAt }) {
    const meta = this._metas.get(channelId)
    if (meta) meta.scheduled_at = scheduledAt
  }

  setCalendarEventId({ channelId, calendarEventId }) {
    const meta = this._metas.get(channelId)
    if (meta) meta.calendar_event_id = calendarEventId
  }

  listByHub({ hubId }) {
    return [...this._channels.values()]
      .filter(ch => ch.hub_id === hubId && !ch.deleted_at)
      .map(ch => ({ ...ch, ...this._metas.get(ch.channel_id), segments: this.listSegments({ channelId: ch.channel_id }) }))
      .sort((a, b) => b.created_at - a.created_at)
  }
}
