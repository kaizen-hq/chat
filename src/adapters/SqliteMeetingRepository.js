import { runTransaction } from '../db/transaction.js'

const MEETING_COLS = `
  c.channel_id, c.hub_id, c.name, c.kind, c.visibility, c.sort_order, c.created_at,
  mm.scheduled_at, mm.ended_at, mm.parent_channel_id, mm.continuation_channel_id, mm.calendar_event_id
`

const JOIN = `
  FROM channels c
  JOIN meeting_meta mm ON mm.channel_id = c.channel_id
`

export class SqliteMeetingRepository {
  constructor({ db }) {
    this.db = db
  }

  /**
   * Atomically insert a channel row (kind='meeting', hub_id=NULL, visibility='private') + meeting_meta.
   * Members are added separately via addMember.
   */
  insertMeeting({ channelId, name, createdByUserId, scheduledAt = null, parentChannelId = null, now }) {
    runTransaction(this.db, () => {
      this.db.prepare(
        `INSERT INTO channels (channel_id, hub_id, kind, name, topic, visibility, sort_order, created_by_user_id, created_at)
         VALUES (?, NULL, 'meeting', ?, NULL, 'private', 0, ?, ?)`
      ).run(channelId, name, createdByUserId, now)
      this.db.prepare(
        `INSERT INTO meeting_meta (channel_id, scheduled_at, ended_at, parent_channel_id, continuation_channel_id, calendar_event_id)
         VALUES (?, ?, NULL, ?, NULL, NULL)`
      ).run(channelId, scheduledAt ?? null, parentChannelId ?? null)
    })
  }

  addMember({ channelId, userId, role = 'member' }) {
    this.db.prepare(
      `INSERT OR REPLACE INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, ?, unixepoch())`
    ).run(channelId, userId, role)
  }

  getMembers({ channelId }) {
    return this.db.prepare(
      `SELECT user_id, role FROM channel_members WHERE channel_id = ?`
    ).all(channelId)
  }

  listForUser({ userId }) {
    const meetings = this.db.prepare(
      `SELECT ${MEETING_COLS} ${JOIN}
       JOIN channel_members cm ON cm.channel_id = c.channel_id AND cm.user_id = ?
       WHERE c.deleted_at IS NULL AND mm.parent_channel_id IS NULL
       ORDER BY c.created_at DESC`
    ).all(userId)
    return meetings.map(m => ({
      ...m,
      segments: this.listSegments({ channelId: m.channel_id }),
    }))
  }

  insertSegment({ channelId, name, dividerMsgId, now }) {
    const result = this.db.prepare(
      `INSERT INTO meeting_segments (channel_id, name, divider_msg_id, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(channelId, name, dividerMsgId ?? null, now)
    return { id: result.lastInsertRowid, channel_id: channelId, name, divider_msg_id: dividerMsgId ?? null, created_at: now, ended_at: null }
  }

  closeSegment({ id, now }) {
    this.db.prepare('UPDATE meeting_segments SET ended_at = ? WHERE id = ?').run(now, id)
  }

  listSegments({ channelId }) {
    return this.db.prepare(
      `SELECT id, channel_id, name, divider_msg_id, created_at, ended_at
       FROM meeting_segments WHERE channel_id = ? ORDER BY created_at ASC`
    ).all(channelId)
  }

  findById({ channelId }) {
    return this.db.prepare(
      `SELECT ${MEETING_COLS} ${JOIN}
       WHERE c.channel_id = ? AND c.deleted_at IS NULL`
    ).get(channelId) ?? null
  }

  closeMeeting({ channelId, now }) {
    this.db.prepare('UPDATE meeting_meta SET ended_at = ? WHERE channel_id = ?').run(now, channelId)
  }

  setContinuation({ channelId, continuationChannelId }) {
    this.db.prepare('UPDATE meeting_meta SET continuation_channel_id = ? WHERE channel_id = ?').run(continuationChannelId, channelId)
  }

  setScheduledAt({ channelId, scheduledAt }) {
    this.db.prepare('UPDATE meeting_meta SET scheduled_at = ? WHERE channel_id = ?').run(scheduledAt, channelId)
  }

  setCalendarEventId({ channelId, calendarEventId }) {
    this.db.prepare('UPDATE meeting_meta SET calendar_event_id = ? WHERE channel_id = ?').run(calendarEventId, channelId)
  }

  listByHub({ hubId }) {
    return this.db.prepare(
      `SELECT ${MEETING_COLS} ${JOIN}
       WHERE c.hub_id = ? AND c.deleted_at IS NULL
       ORDER BY mm.scheduled_at DESC, c.created_at DESC`
    ).all(hubId)
  }

  /**
   * Walk the parent chain from channelId to the root.
   * Returns meetings in chronological order: [root, ..., current].
   */
  getAncestorChain({ channelId }) {
    const chain = []
    let current = channelId
    const visited = new Set()
    while (current && !visited.has(current)) {
      visited.add(current)
      const meeting = this.findById({ channelId: current })
      if (!meeting) break
      chain.unshift(meeting)
      current = meeting.parent_channel_id
    }
    return chain
  }
}
