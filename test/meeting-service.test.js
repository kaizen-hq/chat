import { test, expect, beforeEach } from 'bun:test'
import { MeetingService } from '../src/services/MeetingService.js'
import { InMemoryMeetingRepository } from '../src/adapters/InMemoryMeetingRepository.js'
import { ServiceError } from '../src/util/errors.js'

// Stub: user lookup by email
function makeAuthService(emailMap = {}) {
  return { findUserByEmail: (email) => emailMap[email] ?? null }
}

// Stub: membership check on the meeting channel itself
function makeChannelService(membersByChannel = {}) {
  return {
    isMember: (channelId, userId) => (membersByChannel[channelId] ?? new Set()).has(userId),
    listChannelMembers: (channelId) =>
      [...(membersByChannel[channelId] ?? new Set())].map(uid => ({ user_id: uid, role: 'member' })),
  }
}

let meetingRepo, authService, channelService, service

beforeEach(() => {
  meetingRepo = new InMemoryMeetingRepository()
  authService = makeAuthService({
    'alice@example.com': { user_id: 'u_alice', handle: 'alice', email: 'alice@example.com' },
    'bob@example.com':   { user_id: 'u_bob',   handle: 'bob',   email: 'bob@example.com'   },
  })
  channelService = makeChannelService()
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
})

// ── createMeeting ─────────────────────────────────────────────────────────────

test('createMeeting returns a private meeting with no hub', () => {
  const m = service.createMeeting({ name: 'Retro', userId: 'u1' })
  expect(m.channel_id).toMatch(/^c_/)
  expect(m.kind).toBe('meeting')
  expect(m.hub_id).toBeNull()
  expect(m.visibility).toBe('private')
  expect(m.ended_at).toBeNull()
  expect(m.scheduled_at).toBeNull()
})

test('createMeeting adds invited email users as members', () => {
  const m = service.createMeeting({
    name: 'Sprint Review', userId: 'u1',
    attendeeEmails: ['alice@example.com', 'bob@example.com'],
  })
  const members = meetingRepo.getMembers({ channelId: m.channel_id })
  const userIds = members.map(mm => mm.user_id)
  expect(userIds).toContain('u_alice')
  expect(userIds).toContain('u_bob')
})

test('createMeeting adds creator as owner', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  const members = meetingRepo.getMembers({ channelId: m.channel_id })
  const owner = members.find(mm => mm.user_id === 'u1')
  expect(owner?.role).toBe('owner')
})

test('createMeeting silently skips unknown email addresses', () => {
  const m = service.createMeeting({
    name: 'Planning', userId: 'u1',
    attendeeEmails: ['nobody@example.com'],
  })
  const members = meetingRepo.getMembers({ channelId: m.channel_id })
  expect(members).toHaveLength(1)  // just the creator
})

test('createMeeting rejects empty name', () => {
  expect(() => service.createMeeting({ name: '', userId: 'u1' })).toThrow(ServiceError)
})

test('createMeeting rejects whitespace-only name', () => {
  expect(() => service.createMeeting({ name: '   ', userId: 'u1' })).toThrow(ServiceError)
})

test('createMeeting accepts optional scheduledAt', () => {
  const m = service.createMeeting({ name: 'Planning', userId: 'u1', scheduledAt: '2026-08-20T10:00:00Z' })
  expect(m.scheduled_at).toBe('2026-08-20T10:00:00Z')
})

// ── closeMeeting ──────────────────────────────────────────────────────────────

test('closeMeeting sets ended_at for a meeting member', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  const { meeting } = service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })
  expect(meeting.ended_at).toBe(1000)
})

test('closeMeeting rejects non-member', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  expect(() =>
    service.closeMeeting({ channelId: m.channel_id, userId: 'u_outsider' })
  ).toThrow(ServiceError)
})

test('closeMeeting rejects closing an already-closed meeting', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })
  expect(() => service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })).toThrow(ServiceError)
})

test('closeMeeting rejects missing meeting', () => {
  expect(() => service.closeMeeting({ channelId: 'c_nope', userId: 'u1' })).toThrow(ServiceError)
})

test('closeMeeting returns null closedSegment when no segments exist', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  const { closedSegment } = service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })
  expect(closedSegment).toBeNull()
})

test('closeMeeting closes the active segment when one is open', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  service.continueMeeting({ channelId: m.channel_id, name: 'Stand-up (2)', userId: 'u1' })

  const { closedSegment } = service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })
  expect(closedSegment).not.toBeNull()
  expect(closedSegment.ended_at).toBe(1000)
  expect(closedSegment.name).toBe('Stand-up (2)')
})

test('closeMeeting throws when last segment is already closed and root is closed', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  service.continueMeeting({ channelId: m.channel_id, name: 'Stand-up (2)', userId: 'u1' })
  service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })  // closes segment

  expect(() => service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })).toThrow(ServiceError)
})

// ── continueMeeting ───────────────────────────────────────────────────────────

test('continueMeeting creates a segment in the same channel', () => {
  const m = service.createMeeting({ name: 'Sprint-1', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })

  const { segment } = service.continueMeeting({
    channelId: m.channel_id, name: 'Sprint-2', userId: 'u1',
  })

  expect(segment.channel_id).toBe(m.channel_id)
  expect(segment.name).toBe('Sprint-2')
})

test('continueMeeting auto-closes an open meeting', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })

  service.continueMeeting({ channelId: m.channel_id, name: 'Stand-up (2)', userId: 'u1' })

  const updated = meetingRepo.findById({ channelId: m.channel_id })
  expect(updated.ended_at).toBe(1000)
})

test('continueMeeting works when meeting is already closed', () => {
  const m = service.createMeeting({ name: 'Retro', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })

  const { segment } = service.continueMeeting({
    channelId: m.channel_id, name: 'Retro (2)', userId: 'u1',
  })

  expect(segment.name).toBe('Retro (2)')
})

test('continueMeeting rejects non-member', () => {
  const m = service.createMeeting({ name: 'Sprint-1', userId: 'u1' })
  expect(() =>
    service.continueMeeting({ channelId: m.channel_id, name: 'Sprint-2', userId: 'u_outsider' })
  ).toThrow(ServiceError)
})

test('continueMeeting uses meeting name when segment name is blank', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })

  const { segment } = service.continueMeeting({ channelId: m.channel_id, name: '', userId: 'u1' })
  expect(segment.name).toBe('Stand-up')
})

test('continueMeeting stores divider_msg_id on the segment', () => {
  const m = service.createMeeting({ name: 'Planning', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })

  const { segment } = service.continueMeeting({
    channelId: m.channel_id, name: 'Planning (2)', userId: 'u1', dividerMsgId: 'm_abc',
  })
  expect(segment.divider_msg_id).toBe('m_abc')
})

test('continueMeeting closes the previous segment when continuing again', () => {
  const m = service.createMeeting({ name: 'Review', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })

  service.continueMeeting({ channelId: m.channel_id, name: 'Review (2)', userId: 'u1' })
  const { closedSegment } = service.continueMeeting({ channelId: m.channel_id, name: 'Review (3)', userId: 'u1' })

  expect(closedSegment).not.toBeNull()
  expect(closedSegment.name).toBe('Review (2)')
  expect(closedSegment.ended_at).toBe(1000)
  const segments = meetingRepo.listSegments({ channelId: m.channel_id })
  expect(segments[0].ended_at).toBe(1000)  // first segment closed
  expect(segments[1].ended_at).toBeNull()  // second segment still open
})

test('multiple continuations accumulate as segments', () => {
  const m = service.createMeeting({ name: 'Review', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })

  service.continueMeeting({ channelId: m.channel_id, name: 'Review (2)', userId: 'u1' })
  service.continueMeeting({ channelId: m.channel_id, name: 'Review (3)', userId: 'u1' })

  const segments = meetingRepo.listSegments({ channelId: m.channel_id })
  expect(segments).toHaveLength(2)
  expect(segments[0].name).toBe('Review (2)')
  expect(segments[1].name).toBe('Review (3)')
})

// ── inviteMembers ─────────────────────────────────────────────────────────────

test('inviteMembers adds new users to an open meeting', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  const { added } = service.inviteMembers({ channelId: m.channel_id, userId: 'u1', inviteeUserIds: ['u2'] })
  expect(added).toContain('u2')
})

test('inviteMembers still works after continue (root auto-closed but segment is active)', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  service.continueMeeting({ channelId: m.channel_id, name: 'Stand-up (2)', userId: 'u1' })

  // Root is auto-closed but there's still an active segment — invite must succeed
  const { added } = service.inviteMembers({ channelId: m.channel_id, userId: 'u1', inviteeUserIds: ['u2'] })
  expect(added).toContain('u2')
})

test('inviteMembers rejects when root and all segments are closed', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  service.continueMeeting({ channelId: m.channel_id, name: 'Stand-up (2)', userId: 'u1' })
  service.closeMeeting({ channelId: m.channel_id, userId: 'u1' })  // closes segment

  expect(() =>
    service.inviteMembers({ channelId: m.channel_id, userId: 'u1', inviteeUserIds: ['u2'] })
  ).toThrow(ServiceError)
})

// ── scheduleMeeting ───────────────────────────────────────────────────────────

test('scheduleMeeting sets scheduled_at for a member', async () => {
  const m = service.createMeeting({ name: 'Planning', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  const result = await service.scheduleMeeting({
    channelId: m.channel_id, scheduledAt: '2026-08-20T10:00:00Z', userId: 'u1',
  })
  expect(result.scheduled_at).toBe('2026-08-20T10:00:00Z')
})

test('scheduleMeeting rejects non-member', async () => {
  const m = service.createMeeting({ name: 'Planning', userId: 'u1' })
  await expect(
    service.scheduleMeeting({ channelId: m.channel_id, scheduledAt: '2026-08-20T10:00:00Z', userId: 'u_outsider' })
  ).rejects.toThrow(ServiceError)
})

// ── listMeetings ──────────────────────────────────────────────────────────────

test('listMeetings returns meetings the user is a member of', () => {
  const m1 = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  service.createMeeting({ name: 'Retro', userId: 'u2', attendeeEmails: ['alice@example.com'] })
  const result = meetingRepo.listForUser({ userId: 'u1' })
  const ids = result.map(m => m.channel_id)
  expect(ids).toContain(m1.channel_id)
})

test('listMeetings returns empty array when user has no meetings', () => {
  const result = meetingRepo.listForUser({ userId: 'u_nobody' })
  expect(result).toHaveLength(0)
})

test('listMeetings includes segments for each meeting', () => {
  const m = service.createMeeting({ name: 'Stand-up', userId: 'u1' })
  channelService = makeChannelService({ [m.channel_id]: new Set(['u1']) })
  service = new MeetingService({ meetingRepo, channelService, authService, nowFn: () => 1000 })
  service.continueMeeting({ channelId: m.channel_id, name: 'Stand-up (2)', userId: 'u1' })

  const result = meetingRepo.listForUser({ userId: 'u1' })
  expect(result[0].segments).toHaveLength(1)
  expect(result[0].segments[0].name).toBe('Stand-up (2)')
})
