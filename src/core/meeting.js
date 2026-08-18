/**
 * Pure functions for meeting domain logic.
 */

/**
 * Validate and trim a meeting name.
 * Throws if blank.
 * @param {string} name
 * @returns {string} trimmed name
 */
export function validateMeetingName(name) {
  const trimmed = name?.trim()
  if (!trimmed) throw new Error('Meeting name required')
  return trimmed
}

/**
 * Build the payload for a meeting.created / meeting.list_result event.
 * Includes the segments array so the sidebar can render continuation children.
 * @param {object} meeting
 * @returns {object}
 */
export function buildMeetingEvent(meeting) {
  return {
    channel_id:   meeting.channel_id,
    hub_id:       meeting.hub_id,
    name:         meeting.name,
    kind:         'meeting',
    scheduled_at: meeting.scheduled_at ?? null,
    ended_at:     meeting.ended_at ?? null,
    segments:     meeting.segments ?? [],
  }
}

/**
 * Build the closed event payload.
 * closed_segment is the segment that was just closed, or null if the root was closed.
 * @param {object} meeting
 * @param {object|null} [closedSegment]
 * @returns {object}
 */
export function buildMeetingClosedEvent(meeting, closedSegment = null) {
  return {
    channel_id:     meeting.channel_id,
    hub_id:         meeting.hub_id,
    ended_at:       meeting.ended_at,
    segments:       meeting.segments ?? [],
    closed_segment: closedSegment ?? null,
  }
}
