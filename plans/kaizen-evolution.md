# Kaizen Evolution Plan

**Goal:** Stop losing decisions in infinite scroll. Stop re-litigating things the team already
settled. Give bots a rich, generic surface to capture and surface team knowledge.

**Date:** 2026-08-16

---

## New ADRs

### ADR-007 — ProseMirror document model for rich messages

**Status:** Decided

**Context:** Bots need to post richer content than plaintext markdown — callout cards, action
buttons, document previews, confirmation flows. Raw HTML over the wire is an XSS vector even with
a trusted bot token (prompt injection, future copy-paste to human messages). A structured content
schema is safer and more controllable.

**Decision:** Adopt the ProseMirror JSON document model as the content schema for rich messages.
`messages` grows two columns: `kind TEXT DEFAULT 'text'` and `content_json TEXT`. `kind='text'`
messages render as before. `kind='pm'` messages carry a ProseMirror doc in `content_json`; the
`text` column holds a plain-text fallback for FTS, notifications, and push.

The node type set is intentionally narrow — only types we define and render:

| Node type | Renders as |
|---|---|
| `doc`, `paragraph`, `text`, `hard_break` | Standard inline text |
| `heading` | `h1`–`h6` |
| `blockquote` | `<blockquote>` |
| `bullet_list`, `list_item` | `<ul><li>` |
| `code_block` | `<pre><code>` |
| `horizontal_rule` | `<hr>` |
| `decision_callout` | Styled card with badge + optional `file_ref` attr |
| `architecture_callout` | Styled card with badge + optional `file_ref` attr |
| `historian_ref` | Git commit timeline entry with `repo`, `commit`, `confirmed_by` attrs |
| `document_ref` | Link card to a team document with `path`, `title`, `commit` attrs |
| `action_row` / `action_button` | Confirmation UI; button click sends `msg.send` with `reply_to` |

The client renderer is a bespoke JSON→HTML walker (~80 lines). No ProseMirror editor library is
bundled at this stage. If rich text editing is added later, `prosemirror-model` and
`prosemirror-view` become the natural choice because the stored format is already compatible.

**Consequences:**
- Zero raw HTML crosses the wire; XSS surface eliminated at the schema level
- Any bot generates PM JSON docs; Claude handles a well-defined schema cleanly
- A `text` fallback is required on every `kind='pm'` message — the bot framework helper enforces this
- Migration 011 adds the two columns with no backfill required

---

### ADR-008 — Azure Entra OIDC with local break-glass hybrid

**Status:** Decided

**Context:** The team uses Microsoft 365; Entra SSO removes per-user password management and ties
access lifecycle to the organisation's IdP. A local password escape hatch is still needed for
break-glass admin access when Entra is unavailable.

**Decision:** Primary auth is Azure Entra OIDC (authorization code flow). A parallel local
password path remains, restricted to accounts that have `allow_local_auth: true` in their user
record. On a fresh instance this flag is set only on the bootstrap admin account.

The OIDC flow is implemented with raw `fetch` against the Entra v2 endpoints plus `jose` for JWT
verification — no MSAL, which has untested Bun compatibility. Azure object ID (`oid` claim) is
the durable identity key; it is stored on the `users` row and used for future logins regardless
of UPN/email changes.

**First-run behaviour (supersedes ADR-002 for Entra-enabled instances):**
The server still checks for zero users at boot. If Entra env vars are set, the bootstrap path
creates a placeholder admin account and prints a single-use activation URL. The first Entra user
to complete that URL's OAuth flow is bound to the admin account and inherits the `admin` role.
If Entra env vars are absent, the original invite token bootstrap (ADR-002) is used unchanged —
the instance runs in local-only mode.

**Consequences:**
- `users` gains `entra_oid TEXT UNIQUE`, `email TEXT`, `upn TEXT`, `allow_local_auth INTEGER DEFAULT 0`
- Migration 012 adds these columns; existing users get `allow_local_auth = 1` so no one is locked out during rollout
- New pages: `GET /auth/entra` (redirect), `GET /auth/callback` (code exchange + user mapping)
- New env vars: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_REDIRECT_URI`
- `AuthService` grows `signInWithEntra(oidClaims)` — maps oid → user, creates if new, creates session
- `/login` remains but only accepts credentials for accounts with `allow_local_auth = 1`
- The `jose` package is added to `package.json`

---

### ADR-009 — Meetings as `kind='meeting'` channel with `meeting_meta` table

**Status:** Decided

**Context:** Meetings are time-bounded, archivable conversations that can be continued into a
follow-up meeting. The screenshot mock shows a sidebar meetings section, a continuation link
between parent and child meetings, and a composite thread view spanning the parent→child chain.

**Decision:** A meeting is a `channels` row with `kind='meeting'`. All existing message, delivery,
membership, and search infrastructure applies unchanged. Meeting-specific metadata lives in a
separate `meeting_meta` table joined on `channel_id`, keeping the channels table clean.

```sql
CREATE TABLE meeting_meta (
  channel_id        TEXT PRIMARY KEY REFERENCES channels(channel_id),
  scheduled_at      TEXT,                 -- ISO-8601, nullable = ad-hoc
  ended_at          TEXT,                 -- null = open
  parent_channel_id TEXT REFERENCES channels(channel_id),
  continuation_channel_id TEXT REFERENCES channels(channel_id),
  calendar_event_id TEXT                  -- Graph API event id, nullable
);
```

Meetings are hub-scoped: all hub members can see and join any meeting in that hub. There is no
private meeting at this stage — that can be deferred if the need arises.

The UI renders a "Meetings" section in the sidebar distinct from Hubs/Channels. A closed meeting
(lock icon) has `ended_at` set. The composite thread view (`deploy-catalog-0808 → 0815`)
is the channel view for the continuation meeting, with the parent's messages prepended up to its
`ended_at` timestamp.

**New WS message types:**
- `meeting.create` → `meeting.created` (server push to hub members)
- `meeting.close` → `meeting.closed`
- `meeting.continue` → creates a new meeting with `parent_channel_id` set, sends `meeting.continued`
- `meeting.list` → `meeting.list_result`
- `meeting.schedule` → sets `scheduled_at`, optionally creates Graph API calendar event

**Consequences:**
- Migration 013 creates `meeting_meta`
- `MeetingService` is a new service (thin wrapper around `ChannelService` + meeting_meta writes)
- `meeting.*` WS handlers are a new handler file in `src/ws/handlers/`
- `ChannelService.listChannels` gains a `kind` filter so hub views and meeting sidebar query separately
- The composite thread view requires a new `MeetingRepository.getThreadMessages(channelId)` that
  fetches from parent chain

---

### ADR-010 — Pinned documents: any authorized user or bot can pin a document to a hub or channel

**Status:** Decided

**Context:** Decisions and architecture notes that live only in chat scroll away and get
re-litigated. They need a durable, version-controlled home. Documents live in mesh git repos.
The chat needs a generic surface to pin and surface those documents — discoverable by humans and
reachable by any bot with appropriate permissions.

**Decision:** Any user or bot with member-level access to a hub or channel can pin a document
(a file in a mesh-hosted git repo) to it. Pinning is the act of registering a `(repo, path)`
tuple in the `pinned_documents` table and associating it with a hub or channel. The same document
can be pinned to multiple hubs or channels independently.

```sql
CREATE TABLE pinned_documents (
  doc_id          TEXT PRIMARY KEY,
  hub_id          TEXT REFERENCES hubs(hub_id),      -- null if pinned to a channel
  channel_id      TEXT REFERENCES channels(channel_id), -- null if pinned to a hub
  repo            TEXT NOT NULL,
  path            TEXT NOT NULL,
  title           TEXT NOT NULL,
  last_commit     TEXT,
  last_updated_at TEXT,
  pinned_by       TEXT NOT NULL REFERENCES users(user_id),
  pinned_at       TEXT NOT NULL,
  CHECK (hub_id IS NOT NULL OR channel_id IS NOT NULL)
);
```

**New WS message types:**
- `doc.pin` → pins a document; body: `{ hub_id|channel_id, repo, path, title }`
- `doc.unpin` → removes a pin; body: `{ doc_id }`
- `doc.list` → lists pinned documents; body: `{ hub_id }` or `{ channel_id }`
- `doc.list_result` → server response

A document viewer page (`/docs/:docId`) fetches raw markdown from mesh's git HTTP endpoint,
converts it to PM model client-side, and renders it using the same PM JSON→HTML walker used for
rich messages. Documents are read-only in the chat UI. Editing happens via git.

`document_ref` PM nodes in messages link to `/docs/:docId` for inline card previews. Bots use
`doc.pin` after committing to mesh to surface the document to the team automatically.

**Consequences:**
- Migration 014 creates `pinned_documents`
- `MESH_BASE_URL` env var points the server at the mesh HTTP API
- Document content fetch is a server-side proxy (`GET /api/docs/:docId/content`) to avoid CORS
- Auth check on `doc.pin`/`doc.unpin`: caller must be a member of the target hub or channel
- No bot-only restriction — any member can pin; bots are members (ADR-001)

---

### ADR-011 — Generic bot interaction primitives: action replies and meeting event broadcast

**Status:** Decided

**Context:** Bots built on chatopsjs need two generic server-side capabilities beyond message
send/receive: (1) a reliable way to collect structured responses to a card they posted (the
action button flow), and (2) awareness of meeting lifecycle events so they can react to a meeting
closing without polling.

**Decision:** Both capabilities are served by the existing message infrastructure with two small
additions, keeping no Historian-specific logic in the server.

**Action button replies:**
When a user clicks an `action_button` in a `kind='pm'` message, the client sends a normal
`msg.send` with:
```js
{ reply_to: '<card_msg_id>', body: { value: 'confirm' | 'reject' | <any string> } }
```
The server stores this as a regular message and broadcasts it via `msg.event`. A bot listening
on the channel sees `msg.event` frames with `reply_to` set; it filters for the `msg_id` of its
own card. The server adds one thing: `reply_to` is validated to be an existing `msg_id` in the
same channel before storage, preventing dangling references.

`body.value` is a free-form string — the server does not interpret it. Bot authors choose their
own value contract.

**Meeting lifecycle broadcast:**
When `meeting.close` is called, the server broadcasts a `meeting.closed` push frame to all
hub members (not just channel subscribers). This is the signal bots use to trigger post-meeting
processing. The frame body includes `{ channel_id, hub_id, ended_at, parent_channel_id }` so
a bot can fetch the full thread without a separate lookup.

Bots also receive `meeting.created` and `meeting.continued` broadcasts on the hub topic so they
can auto-join new meetings as members (via `channel.join`) before messages start flowing.

**Consequences:**
- `reply_to` validation is a one-line check in `msgHandlers.js`
- `meeting.closed` push frame is sent to the hub's Bun pub/sub topic (`hub:<id>`) in addition
  to the channel topic so all hub-member bots receive it regardless of channel membership
- No new WS message types beyond what ADR-009 already defines for meeting lifecycle
- Bots that want to auto-join meetings listen for `meeting.created` and call `channel.join` —
  same pattern as any other channel

---

## Implementation phases

### Phase 1 — ProseMirror message kind (foundational, no auth dependency)

**Migration 011:**
```sql
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN content_json TEXT;
```

**Files to create/modify:**
- `migrate/011-pm-messages.js` — migration
- `src/core/pmDoc.js` — pure functions: `buildCard(type, body, actions)`, `buildHistorianRef(repo, commit, confirmedBy)`, `buildDocumentRef(docId, path, title)`, `pmDocToText(doc)` (for FTS fallback)
- `src/services/MessageService.js` — validate `kind='pm'` messages have `content_json` + `text`
- `src/ws/handlers/msgHandlers.js` — pass `kind` and `content_json` through on `msg.send` / `msg.event`
- `pages/public/client/islands/pm-renderer.js` — JSON→HTML walker for PM nodes
- `pages/public/client/islands/message-list.js` — branch on `msg.kind` to use PM renderer

**Test:**
```js
test('pmDocToText extracts plain text from a pm doc', () => { ... })
test('msg.send with kind=pm stores content_json and text fallback', () => { ... })
test('msg.send with kind=pm and no text is rejected', () => { ... })
```

---

### Phase 2 — Azure Entra OIDC + break-glass hybrid

**Migration 012:**
```sql
ALTER TABLE users ADD COLUMN entra_oid TEXT UNIQUE;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN upn TEXT;
ALTER TABLE users ADD COLUMN allow_local_auth INTEGER NOT NULL DEFAULT 0;
-- Existing users keep local auth so no one is locked out
UPDATE users SET allow_local_auth = 1;
```

**New env vars:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_REDIRECT_URI`

**Files to create/modify:**
- `migrate/012-entra-auth.js`
- `package.json` — add `jose`
- `src/services/AuthService.js` — add `signInWithEntra(claims)`, modify `signInWithPassword` to check `allow_local_auth`
- `src/core/entraOidc.js` — pure functions: `buildAuthUrl(tenantId, clientId, redirectUri, state, nonce)`, `exchangeCode(tenantId, clientId, secret, code, redirectUri)`, `verifyIdToken(token, tenantId, clientId, nonce)` using `jose`
- `pages/auth/entra.js` — `GET`: generate state+nonce (store in signed cookie), redirect to Entra
- `pages/auth/callback.js` — `GET`: verify state, call `exchangeCode`, call `verifyIdToken`, call `AuthService.signInWithEntra`, set session cookie, redirect to `/`
- `pages/login/index.js` — keep as-is; add note in form that Entra users should use the SSO button
- `src/context.js` — add Entra config to the wire-up

**Bootstrap change (Entra mode):**
```js
// In index.js startup, when Entra vars are present and no users exist:
// 1. Create a placeholder admin user (no password, allow_local_auth=0, entra_oid=null)
// 2. Generate a one-time activation token (existing randomToken() infra)
// 3. Print: "[boot] Activate admin via Entra: https://chat.example.com/auth/entra?activate=<token>"
// 4. On /auth/callback: if activate token is present and valid, bind oid to the placeholder admin
```

**Tests:**
```js
test('signInWithEntra creates user on first login with oid')
test('signInWithEntra maps returning user by oid ignoring upn change')
test('signInWithPassword rejects users with allow_local_auth=0')
test('verifyIdToken rejects expired token')
test('verifyIdToken rejects wrong audience')
```

---

### Phase 3 — Meetings

**Migration 013:**
```sql
-- meeting_meta table
CREATE TABLE IF NOT EXISTS meeting_meta (
  channel_id              TEXT PRIMARY KEY REFERENCES channels(channel_id),
  scheduled_at            TEXT,
  ended_at                TEXT,
  parent_channel_id       TEXT REFERENCES channels(channel_id),
  continuation_channel_id TEXT REFERENCES channels(channel_id),
  calendar_event_id       TEXT
);
```

**Graph API calendar invites use the meeting creator's delegated access token**, obtained during
the Entra OIDC flow at `/auth/callback`. The `Calendars.ReadWrite` delegated scope must be
requested during authorization. The access token (short-lived) and refresh token are stored in
the session record so the server can call Graph on the user's behalf when `meeting.schedule` is
called. The refresh token is used to obtain a fresh access token if the original has expired.

**New env vars (Graph API):** `GRAPH_CALENDAR_SCOPE` (e.g. `Calendars.ReadWrite offline_access`)
added to the Entra OIDC authorization request. No separate Graph app registration is required —
Graph permissions are added to the same Entra app used for OIDC. `AZURE_CLIENT_ID` and
`AZURE_CLIENT_SECRET` already cover token exchange.

**Migration 012 update:** `sessions` table gains `access_token TEXT` and `refresh_token TEXT`
columns to carry the delegated Graph tokens alongside the session. These are encrypted at rest
using a `SESSION_ENCRYPTION_KEY` env var (AES-256-GCM via the WebCrypto API).

**Files to create/modify:**
- `migrate/013-meetings.js`
- `src/core/meeting.js` — `validateMeetingName(name)`, `buildMeetingCreatedEvent(meeting)`, `buildContinuationLink(parent, child)`
- `src/adapters/SqliteMeetingRepository.js` — `insertMeeting`, `findById`, `close`, `setContinuation`, `listByHub`, `getThread(channelId)` (fetches parent chain messages)
- `src/adapters/GraphCalendarAdapter.js` — `createCalendarEvent(subject, start, end, attendees, accessToken)`, `cancelCalendarEvent(eventId, accessToken)`, `refreshAccessToken(refreshToken)` using `fetch` against Graph API with the creator's delegated token
- `src/services/MeetingService.js` — `createMeeting`, `closeMeeting`, `continueMeeting`, `scheduleMeeting`, `listMeetings`
- `src/ws/handlers/meetingHandlers.js` — `meeting.create`, `meeting.close`, `meeting.continue`, `meeting.schedule`, `meeting.list`
- `src/ws/ChatServer.js` — register meeting handlers in `#route()`
- `pages/channels/[channelId].js` — extend to handle `kind='meeting'`; pass parent chain data
- `pages/public/client/islands/sidebar.js` — Meetings section, separate from Hubs
- `pages/public/client/islands/meeting-thread.js` — composite parent→child thread view with continuation divider

**Tests:**
```js
test('createMeeting creates a channel with kind=meeting and a meeting_meta row')
test('closeMeeting sets ended_at and prevents new messages after close')
test('continueMeeting creates a child meeting with parent_channel_id set')
test('continueMeeting sets continuation_channel_id on the parent')
test('listMeetings returns meetings ordered by scheduled_at desc')
test('getThread returns parent messages before continuation divider')
```

---

### Phase 4 — Pinned documents

**Migration 014:**
```sql
CREATE TABLE IF NOT EXISTS pinned_documents (
  doc_id          TEXT PRIMARY KEY,
  hub_id          TEXT REFERENCES hubs(hub_id),
  channel_id      TEXT REFERENCES channels(channel_id),
  repo            TEXT NOT NULL,
  path            TEXT NOT NULL,
  title           TEXT NOT NULL,
  last_commit     TEXT,
  last_updated_at TEXT,
  pinned_by       TEXT NOT NULL REFERENCES users(user_id),
  pinned_at       TEXT NOT NULL,
  CHECK (hub_id IS NOT NULL OR channel_id IS NOT NULL)
);
```

**New env var:** `MESH_BASE_URL` (e.g. `http://localhost:7979`)

**Files to create/modify:**
- `migrate/014-pinned-documents.js`
- `src/adapters/SqliteDocumentRepository.js` — `pin(doc)`, `unpin(docId)`, `findById(docId)`, `listByHub(hubId)`, `listByChannel(channelId)`
- `src/adapters/MeshGitAdapter.js` — `fetchRawFile(repo, path, ref)`, `getLatestCommit(repo, path)`
- `src/services/DocumentService.js` — `pinDocument(userId, body)`, `unpinDocument(userId, docId)`, `getDocumentContent(docId)`, `listDocuments(filter)`
- `src/ws/handlers/docHandlers.js` — `doc.pin`, `doc.unpin`, `doc.list` handlers; auth: caller must be a member of the target hub or channel
- `pages/api/docs/[docId]/content.js` — server-side proxy: fetches from mesh via `MeshGitAdapter`, returns markdown string
- `pages/public/client/islands/document-viewer.js` — fetches `/api/docs/:id/content`, converts markdown→PM model, renders via PM renderer
- `src/ws/ChatServer.js` — register doc handlers

**Tests:**
```js
test('doc.pin requires membership in the target hub or channel')
test('doc.pin stores a pinned_documents row and returns doc_id')
test('doc.unpin removes the row; non-members cannot unpin')
test('doc.list returns documents pinned to a hub ordered by pinned_at desc')
test('getDocumentContent proxies to mesh and returns markdown')
test('document_ref PM node renders as a link card with title and path')
```

---

### Phase 5 — Generic bot interaction features (server-side)

These are server features any bot built on chatopsjs can use. No Historian-specific logic belongs here.

**5a — Action button reply validation**

`reply_to` on `msg.send` is already stored and broadcast. One addition: the server validates that
`reply_to` references an existing `msg_id` in the same channel before storing the message.
Dangling `reply_to` values are rejected with a `ServiceError`. `body.value` is passed through
opaquely — the server never interprets it; bots define their own value contracts.

- `src/services/MessageService.js` — add `reply_to` existence check (single SQL query)
- `src/ws/handlers/msgHandlers.js` — reject with `{ ok: false, error: { code: 'INVALID_REPLY_TO' } }` on failure

**5b — Meeting lifecycle broadcast to hub topic**

`meeting.closed`, `meeting.created`, and `meeting.continued` events are published to the hub's
Bun pub/sub topic (`hub:<hub_id>`) in addition to the channel topic. This lets bots that have
subscribed at the hub level receive meeting events without having to be a member of every
individual meeting channel upfront.

The `meeting.closed` frame body includes:
```js
{ channel_id, hub_id, ended_at, parent_channel_id, continuation_channel_id }
```
so a bot can fetch the full thread with a single `msg.list` call using `channel_id` and fetch
the parent's messages with `parent_channel_id` — no extra round-trip.

- `src/ws/handlers/meetingHandlers.js` — publish to `hub:<hub_id>` after publishing to `channel:<channel_id>`
- `src/ws/ChatServer.js` — ensure hub topic subscription is established when a bot calls `channel.join` for any channel in the hub

**5c — `msg.list` thread mode for meeting continuation chains**

`msg.list` gains an optional `thread: true` parameter. When set on a meeting channel, the
response includes messages from the full parent chain in chronological order, with a
`{ kind: 'continuation_divider', parent_channel_id, child_channel_id }` synthetic entry
inserted at each junction. This is the same data the UI uses for the composite thread view, now
also available to bots for synthesis without multiple round-trips.

- `src/services/MessageService.js` — `listMessages(channelId, opts)` delegates to `MeetingRepository.getThread(channelId)` when `opts.thread` is true and the channel is `kind='meeting'`
- `src/ws/handlers/msgHandlers.js` — pass `thread` param through

**Tests:**
```js
test('msg.send with invalid reply_to is rejected with INVALID_REPLY_TO')
test('msg.send with valid reply_to stores body.value opaquely')
test('meeting.closed is broadcast on hub:<hub_id> topic')
test('msg.list with thread=true returns parent chain messages with continuation dividers')
test('msg.list with thread=true on a non-meeting channel ignores thread param')
```

---

## Dependency order

```
011 (PM messages) ──► Phase 1 complete
        │
        ▼
012 (Entra auth) ──► Phase 2 complete
        │
        ▼
013 (Meetings) ──► Phase 3 complete
        │
        ├──► 014 (Pinned documents) ──► Phase 4 complete
        │
        └──► Phase 5 (bot interaction features, no migration needed)
```

Each phase can be deployed independently. A bot using `doc.pin` and the action button flow
requires Phase 1 (`kind='pm'`) and Phase 4 (`doc.pin`) to be live in the server.
