import { newId } from '../util/ids.js'
import { ServiceError } from '../util/errors.js'

export class MeetingService {
  /**
   * @param {object} deps
   * @param {object} deps.meetingRepo
   * @param {object} deps.channelService    – isMember(channelId, userId), listChannelMembers(channelId)
   * @param {object} deps.authService       – findUserByEmail(email) → { user_id, ... } | null
   * @param {object} [deps.graphCalendarAdapter]  optional
   * @param {() => number} [deps.nowFn]
   */
  constructor({ meetingRepo, channelService, authService, graphCalendarAdapter = null, nowFn = () => Date.now() }) {
    this.meetingRepo          = meetingRepo
    this.channelService       = channelService
    this.authService          = authService
    this.graphCalendarAdapter = graphCalendarAdapter
    this.nowFn                = nowFn
  }

  /**
   * Create a new private meeting. Creator is added as owner.
   * Attendees can be specified by user ID (attendeeUserIds) or email (attendeeEmails).
   * Unknown emails are silently skipped. Duplicate or self-references are ignored.
   * @returns {object} meeting record
   */
  createMeeting({ name, userId, attendeeUserIds = [], attendeeEmails = [], scheduledAt = null }) {
    const trimmed = name?.trim()
    if (!trimmed) throw new ServiceError('BAD_REQUEST', 'Meeting name required')

    const channelId = newId('c')
    const now = this.nowFn()

    this.meetingRepo.insertMeeting({ channelId, name: trimmed, createdByUserId: userId, scheduledAt, now })
    this.meetingRepo.addMember({ channelId, userId, role: 'owner' })

    const added = new Set([userId])

    for (const uid of attendeeUserIds) {
      if (!uid || added.has(uid)) continue
      this.meetingRepo.addMember({ channelId, userId: uid, role: 'member' })
      added.add(uid)
    }

    for (const email of attendeeEmails) {
      const user = this.authService.findUserByEmail(email)
      if (user && !added.has(user.user_id)) {
        this.meetingRepo.addMember({ channelId, userId: user.user_id, role: 'member' })
        added.add(user.user_id)
      }
    }

    return {
      channel_id: channelId, hub_id: null, kind: 'meeting',
      name: trimmed, visibility: 'private',
      scheduled_at: scheduledAt ?? null,
      ended_at: null,
      parent_channel_id: null,
      continuation_channel_id: null,
      calendar_event_id: null,
    }
  }

  /**
   * Close a meeting (or its active segment).
   *
   * If the meeting has segments and the last one is still open, that segment is
   * closed (and the root meeting is closed too if not already). Otherwise the
   * root meeting itself is closed.
   *
   * Caller must be a member of the meeting channel.
   * @returns {{ meeting: object, closedSegment: object|null }}
   */
  closeMeeting({ channelId, userId }) {
    const meeting = this.meetingRepo.findById({ channelId })
    if (!meeting) throw new ServiceError('NOT_FOUND', 'Meeting not found')
    if (!this.channelService.isMember(channelId, userId)) {
      throw new ServiceError('FORBIDDEN', 'Not a member of this meeting')
    }

    const segments = this.meetingRepo.listSegments({ channelId })
    const lastOpenSeg = segments.filter(s => !s.ended_at).pop() ?? null

    const now = this.nowFn()
    let closedSegment = null

    if (lastOpenSeg) {
      this.meetingRepo.closeSegment({ id: lastOpenSeg.id, now })
      closedSegment = { ...lastOpenSeg, ended_at: now }
      // Ensure root is closed too (may already be closed via auto-close on Continue)
      if (!meeting.ended_at) this.meetingRepo.closeMeeting({ channelId, now })
    } else {
      if (meeting.ended_at) throw new ServiceError('BAD_REQUEST', 'Meeting is already closed')
      this.meetingRepo.closeMeeting({ channelId, now })
    }

    const updatedMeeting = this.meetingRepo.findById({ channelId })
    return {
      meeting: { ...updatedMeeting, segments: this.meetingRepo.listSegments({ channelId }) },
      closedSegment,
    }
  }

  /**
   * Continue a meeting by creating a new named segment within the same channel.
   * Auto-closes the meeting if it is still open.
   * The dividerMsgId is the msg_id of the continuation_divider message that the
   * WS handler inserts immediately before calling this — it anchors the scroll position.
   * @returns {{ meeting: object, segment: object }}
   */
  continueMeeting({ channelId, name, userId, dividerMsgId = null }) {
    const meeting = this.meetingRepo.findById({ channelId })
    if (!meeting) throw new ServiceError('NOT_FOUND', 'Meeting not found')
    if (!this.channelService.isMember(channelId, userId)) {
      throw new ServiceError('FORBIDDEN', 'Not a member of this meeting')
    }

    const segmentName = name?.trim() || meeting.name
    const now = this.nowFn()

    // Close the currently active segment (if any)
    const existingSegments = this.meetingRepo.listSegments({ channelId })
    const lastOpenSeg = existingSegments.filter(s => !s.ended_at).pop() ?? null
    let closedSegment = null
    if (lastOpenSeg) {
      this.meetingRepo.closeSegment({ id: lastOpenSeg.id, now })
      closedSegment = { ...lastOpenSeg, ended_at: now }
    }

    // Auto-close root if still open
    if (!meeting.ended_at) {
      this.meetingRepo.closeMeeting({ channelId, now })
    }

    const segment = this.meetingRepo.insertSegment({ channelId, name: segmentName, dividerMsgId, now })
    const updatedMeeting = this.meetingRepo.findById({ channelId })
    return { meeting: { ...updatedMeeting, segments: this.meetingRepo.listSegments({ channelId }) }, segment, closedSegment }
  }

  /**
   * Set (or update) the scheduled time for a meeting.
   * Caller must be a member of the meeting channel.
   * @returns {object} updated meeting record
   */
  async scheduleMeeting({ channelId, scheduledAt, userId, accessToken = null }) {
    const meeting = this.meetingRepo.findById({ channelId })
    if (!meeting) throw new ServiceError('NOT_FOUND', 'Meeting not found')
    const schedSegments = this.meetingRepo.listSegments({ channelId })
    const schedHasActive = schedSegments.some(s => !s.ended_at)
    if (meeting.ended_at && !schedHasActive) throw new ServiceError('BAD_REQUEST', 'Cannot schedule a closed meeting')
    if (!this.channelService.isMember(channelId, userId)) {
      throw new ServiceError('FORBIDDEN', 'Not a member of this meeting')
    }

    this.meetingRepo.setScheduledAt({ channelId, scheduledAt })

    let calendarEventId = meeting.calendar_event_id ?? null
    if (accessToken && this.graphCalendarAdapter) {
      try {
        const startDate = new Date(scheduledAt)
        const endDate   = new Date(startDate.getTime() + 60 * 60 * 1000)
        const { eventId } = await this.graphCalendarAdapter.createCalendarEvent({
          subject: meeting.name,
          startAt: startDate.toISOString(),
          endAt:   endDate.toISOString(),
          accessToken,
        })
        calendarEventId = eventId
        this.meetingRepo.setCalendarEventId({ channelId, calendarEventId })
      } catch {
        // Calendar integration is best-effort
      }
    }

    return { ...meeting, scheduled_at: scheduledAt, calendar_event_id: calendarEventId }
  }

  /**
   * List all root meetings the user is a member of (ordered most recent first),
   * each with their segments array.
   */
  listMeetings({ userId }) {
    return this.meetingRepo.listForUser({ userId })
  }

  /**
   * Return the member list for a meeting channel.
   */
  getMeetingMembers({ channelId }) {
    return this.meetingRepo.getMembers({ channelId })
  }

  /**
   * Add more members to an existing active meeting.
   * A meeting is considered active if its root is open OR it has an open segment.
   * Caller must already be a member. Silently skips unknown or already-added user IDs.
   * @returns {{ added: string[] }} user IDs that were newly added
   */
  inviteMembers({ channelId, userId, inviteeUserIds = [] }) {
    const meeting = this.meetingRepo.findById({ channelId })
    if (!meeting) throw new ServiceError('NOT_FOUND', 'Meeting not found')
    const segments = this.meetingRepo.listSegments({ channelId })
    const hasActiveSegment = segments.some(s => !s.ended_at)
    if (meeting.ended_at && !hasActiveSegment) throw new ServiceError('BAD_REQUEST', 'Cannot invite to a closed meeting')
    if (!this.channelService.isMember(channelId, userId)) {
      throw new ServiceError('FORBIDDEN', 'Not a member of this meeting')
    }

    const existing = new Set(this.meetingRepo.getMembers({ channelId }).map(m => m.user_id))
    const added = []
    for (const uid of inviteeUserIds) {
      if (!uid || existing.has(uid)) continue
      this.meetingRepo.addMember({ channelId, userId: uid, role: 'member' })
      added.push(uid)
    }
    return { added, meeting: { ...meeting, segments } }
  }
}
