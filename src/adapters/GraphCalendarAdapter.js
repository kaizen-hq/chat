/**
 * GraphCalendarAdapter — I/O adapter for Microsoft Graph calendar API.
 * Uses the meeting creator's delegated access token (from the Entra OIDC session).
 */
export class GraphCalendarAdapter {
  constructor({ graphEndpoint = 'https://graph.microsoft.com/v1.0' } = {}) {
    this.graphEndpoint = graphEndpoint
  }

  /**
   * Create a calendar event on the authenticated user's calendar.
   * @param {object} opts
   * @param {string}   opts.subject
   * @param {string}   opts.startAt      ISO-8601 datetime (UTC)
   * @param {string}   opts.endAt        ISO-8601 datetime (UTC)
   * @param {string[]} [opts.attendees]  array of email addresses
   * @param {string}   opts.accessToken  delegated Graph access token
   * @returns {Promise<{ eventId: string }>}
   */
  async createCalendarEvent({ subject, startAt, endAt, attendees = [], accessToken }) {
    const body = {
      subject,
      start: { dateTime: startAt, timeZone: 'UTC' },
      end:   { endAt,   timeZone: 'UTC' },
      attendees: attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required',
      })),
    }
    const res = await fetch(`${this.graphEndpoint}/me/events`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Graph API error creating event: ${res.status} — ${text}`)
    }
    const event = await res.json()
    return { eventId: event.id }
  }

  /**
   * Delete (cancel) a calendar event.
   * @param {{ eventId: string, accessToken: string }} opts
   */
  async cancelCalendarEvent({ eventId, accessToken }) {
    const res = await fetch(`${this.graphEndpoint}/me/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok && res.status !== 404) {
      const text = await res.text()
      throw new Error(`Graph API error deleting event: ${res.status} — ${text}`)
    }
  }
}
