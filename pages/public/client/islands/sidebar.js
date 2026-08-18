/**
 * sidebar.js — rdbljs island for hub/channel navigation and online presence.
 *
 * Mounted on: <aside island="/client/islands/sidebar.js" ...>
 */
import { signal, getItemContext, effect, computed, Context } from '@devchitchat/rdbljs'
import { WsClient } from '../ws.js'
import { escHtml } from '../shared/messages.js'
import { addLongPress } from '../long-press.js'
import { showActionSheet, dismiss as dismissSheet, getItemsContainer } from '../action-sheet.js'
import { showModal, dismiss as dismissModal } from '../modal.js'
import { renderAvatar, PALETTE, initials, colorFromId } from '../avatar.js'
import { getSettings, patchSettings } from '../settings-sync.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const isTouch = () => window.matchMedia('(pointer: coarse)').matches

function populateFromDom(root) {
  return Array.from(root.querySelectorAll('details')).map(el => {
    const hub_id = el.dataset.key
    return {
      hub_id,
      name: el.querySelector('.hub-name span').textContent.trim(),
      visibility:   el.dataset.visibility ?? 'public',
      description:  el.dataset.description ?? null,
      channels: Array.from(el.querySelectorAll('li')).map(li => {
        const link = li.querySelector('a')
        return {
          channel_id:  li.dataset.key,
          hub_id,
          name:        link.textContent.trim(),
          url:         link.href,
          topic:       link.dataset.channelTopic ?? null,
          visibility:  link.dataset.channelVisibility ?? 'public',
          selected:    li.dataset.selected === 'true',
          className:   li.className.trim()
        }
      })
    }
  })
}

// ── Form builders ─────────────────────────────────────────────────────────────

function buildHubForm(container, { hubId, hubName, hubDescription, hubVisibility, ws, dismiss }) {
  const currentVisibility = hubVisibility ?? 'public'
  container.innerHTML = `
    <div class="field">
      <label for="hub-name-input">Hub name</label>
      <input id="hub-name-input" type="text" value="${escHtml(hubName)}" maxlength="80" autocomplete="off">
    </div>
    <div class="field">
      <label for="hub-desc-input">Description <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <input id="hub-desc-input" type="text" value="${escHtml(hubDescription ?? '')}" maxlength="240" autocomplete="off">
    </div>
    <div class="field">
      <label for="hub-visibility-input">Visibility</label>
      <select id="hub-visibility-input">
        <option value="public" ${currentVisibility === 'public' ? 'selected' : ''}>Public — visible to everyone on this instance</option>
        <option value="restricted" ${currentVisibility === 'restricted' ? 'selected' : ''}>Restricted — only added members can see it</option>
      </select>
    </div>
    <div id="hub-members-section" style="display:${currentVisibility === 'restricted' ? 'block' : 'none'}">
      <div class="field">
        <label>Members</label>
        <div id="hub-members-list" class="members-list"><em style="color:var(--text-muted);font-size:13px">Loading…</em></div>
      </div>
      <div class="field">
        <label for="hub-add-member-select">Add member</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="hub-add-member-select" style="flex:1"><option value="">— select a user —</option></select>
          <button id="hub-add-member-btn" type="button" class="btn-primary" style="white-space:nowrap">Add</button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="hub-cancel-btn" type="button">Cancel</button>
      <button class="btn-primary" id="hub-save-btn" type="button">Save</button>
    </div>
    <div class="modal-danger-zone">
      <p>Deleting this hub removes it and all its channels permanently.</p>
      <button class="btn-danger" id="hub-delete-btn" type="button">Delete hub</button>
    </div>
  `

  const visibilitySelect = container.querySelector('#hub-visibility-input')
  const membersSection = container.querySelector('#hub-members-section')

  // Show/hide members section when visibility changes
  visibilitySelect.addEventListener('change', () => {
    const isRestricted = visibilitySelect.value === 'restricted'
    membersSection.style.display = isRestricted ? 'block' : 'none'
    if (isRestricted) loadMembers()
  })

  let membersLoaded = false
  function loadMembers() {
    if (membersLoaded) return
    membersLoaded = true

    let members = []
    let allUsers = []

    function render() {
      const memberIds = new Set(members.map(m => m.user_id))

      const listEl = container.querySelector('#hub-members-list')
      if (members.length === 0) {
        listEl.innerHTML = '<em style="color:var(--text-muted);font-size:13px">No members yet.</em>'
      } else {
        listEl.innerHTML = members.map(m => `
          <div class="member-row" data-user-id="${escHtml(m.user_id)}" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">
            <span>${escHtml(m.display_name ?? m.handle ?? m.user_id)}</span>
            <button type="button" class="btn-ghost btn-sm hub-remove-member" data-user-id="${escHtml(m.user_id)}" style="font-size:12px">Remove</button>
          </div>
        `).join('')
        listEl.querySelectorAll('.hub-remove-member').forEach(btn => {
          btn.addEventListener('click', () => {
            const uid = btn.dataset.userId
            ws.send({ t: 'hub.remove_member', body: { hub_id: hubId, user_id: uid } })
            members = members.filter(m => m.user_id !== uid)
            render()
          })
        })
      }

      const sel = container.querySelector('#hub-add-member-select')
      const available = allUsers.filter(u => !memberIds.has(u.user_id))
      sel.innerHTML = '<option value="">— select a user —</option>' +
        available.map(u => `<option value="${escHtml(u.user_id)}">${escHtml(u.display_name ?? u.handle)}</option>`).join('')
    }

    ws.once('hub.list_members_result', ({ hub_id, members: m }) => {
      if (hub_id !== hubId) return
      members = m
      render()
    })
    ws.once('user.list_result', ({ users }) => {
      allUsers = users
      render()
    })

    ws.send({ t: 'hub.list_members', body: { hub_id: hubId } })
    ws.send({ t: 'user.list', body: {} })
  }

  // Load immediately if already restricted
  if (currentVisibility === 'restricted') loadMembers()

  container.querySelector('#hub-add-member-btn').addEventListener('click', () => {
    const sel = container.querySelector('#hub-add-member-select')
    const userId = sel.value
    if (!userId) return
    ws.send({ t: 'hub.add_member', body: { hub_id: hubId, user_id: userId } })
    membersLoaded = false
    loadMembers()
  })

  container.querySelector('#hub-cancel-btn').addEventListener('click', dismiss)
  container.querySelector('#hub-save-btn').addEventListener('click', () => {
    const name = container.querySelector('#hub-name-input').value.trim()
    if (!name) return
    ws.send({ t: 'hub.update', body: {
      hub_id:      hubId,
      name,
      description: container.querySelector('#hub-desc-input').value.trim() || null,
      visibility:  visibilitySelect.value,
    } })
    dismiss()
  })
  container.querySelector('#hub-delete-btn').addEventListener('click', () => {
    ws.send({ t: 'hub.delete', body: { hub_id: hubId } })
    dismiss()
  })
  requestAnimationFrame(() => container.querySelector('#hub-name-input')?.focus())
}

function buildChannelForm(container, { channelId, channelName, channelTopic, channelVisibility, ws, dismiss }) {
  const currentVisibility = channelVisibility ?? 'public'
  container.innerHTML = `
    <div class="field">
      <label for="ch-name-input">Channel name</label>
      <input id="ch-name-input" type="text" value="${escHtml(channelName)}" maxlength="80" autocomplete="off">
    </div>
    <div class="field">
      <label for="ch-topic-input">Topic <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <input id="ch-topic-input" type="text" value="${escHtml(channelTopic ?? '')}" maxlength="240" autocomplete="off">
    </div>
    <div class="field">
      <label for="ch-visibility-input">Visibility</label>
      <select id="ch-visibility-input">
        <option value="public" ${currentVisibility === 'public' ? 'selected' : ''}>Public — visible to everyone in this hub</option>
        <option value="private" ${currentVisibility === 'private' ? 'selected' : ''}>Private — only added members can see it</option>
      </select>
    </div>
    <div id="ch-members-section" style="display:${currentVisibility === 'private' ? 'block' : 'none'}">
      <div class="field">
        <label>Members</label>
        <div id="ch-members-list" class="members-list"><em style="color:var(--text-muted);font-size:13px">Loading…</em></div>
      </div>
      <div class="field">
        <label for="ch-add-member-select">Add member</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="ch-add-member-select" style="flex:1"><option value="">— select a user —</option></select>
          <button id="ch-add-member-btn" type="button" class="btn-primary" style="white-space:nowrap">Add</button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="ch-cancel-btn" type="button">Cancel</button>
      <button class="btn-primary" id="ch-save-btn" type="button">Save</button>
    </div>
    <div class="modal-danger-zone">
      <p>Deleting this channel removes all its messages permanently.</p>
      <button class="btn-danger" id="ch-delete-btn" type="button">Delete channel</button>
    </div>
  `

  const visibilitySelect = container.querySelector('#ch-visibility-input')
  const membersSection = container.querySelector('#ch-members-section')

  // Show/hide members section when visibility changes
  visibilitySelect.addEventListener('change', () => {
    const isPrivate = visibilitySelect.value === 'private'
    membersSection.style.display = isPrivate ? 'block' : 'none'
    if (isPrivate) loadMembers()
  })

  // Load members and user list for the picker
  let membersLoaded = false
  function loadMembers() {
    if (membersLoaded) return
    membersLoaded = true

    let members = []
    let allUsers = []

    function render() {
      const memberIds = new Set(members.map(m => m.user_id))

      // Render current members list
      const listEl = container.querySelector('#ch-members-list')
      if (members.length === 0) {
        listEl.innerHTML = '<em style="color:var(--text-muted);font-size:13px">No members yet.</em>'
      } else {
        listEl.innerHTML = members.map(m => `
          <div class="member-row" data-user-id="${escHtml(m.user_id)}" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">
            <span>${escHtml(m.display_name ?? m.handle)} <span style="color:var(--text-muted);font-size:12px">${escHtml(m.role)}</span></span>
            ${m.role !== 'owner' ? `<button type="button" class="btn-ghost btn-sm ch-remove-member" data-user-id="${escHtml(m.user_id)}" style="font-size:12px">Remove</button>` : ''}
          </div>
        `).join('')
        listEl.querySelectorAll('.ch-remove-member').forEach(btn => {
          btn.addEventListener('click', () => {
            const uid = btn.dataset.userId
            ws.send({ t: 'channel.remove_member', body: { channel_id: channelId, user_id: uid } })
            members = members.filter(m => m.user_id !== uid)
            render()
          })
        })
      }

      // Render add-member picker (exclude existing members)
      const sel = container.querySelector('#ch-add-member-select')
      const available = allUsers.filter(u => !memberIds.has(u.user_id))
      sel.innerHTML = '<option value="">— select a user —</option>' +
        available.map(u => `<option value="${escHtml(u.user_id)}">${escHtml(u.display_name ?? u.handle)}</option>`).join('')
    }

    ws.once('channel.list_members_result', ({ channel_id, members: m }) => {
      if (channel_id !== channelId) return
      members = m
      render()
    })
    ws.once('user.list_result', ({ users }) => {
      allUsers = users
      render()
    })

    ws.send({ t: 'channel.list_members', body: { channel_id: channelId } })
    ws.send({ t: 'user.list', body: {} })
  }

  // Load immediately if already private
  if (currentVisibility === 'private') loadMembers()

  container.querySelector('#ch-add-member-btn').addEventListener('click', () => {
    const sel = container.querySelector('#ch-add-member-select')
    const userId = sel.value
    if (!userId) return
    ws.send({ t: 'channel.add_member', body: { channel_id: channelId, user_id: userId } })
    // Optimistically reload
    membersLoaded = false
    loadMembers()
  })

  container.querySelector('#ch-cancel-btn').addEventListener('click', dismiss)
  container.querySelector('#ch-save-btn').addEventListener('click', () => {
    const name = container.querySelector('#ch-name-input').value.trim()
    if (!name) return
    ws.send({ t: 'channel.update', body: {
      channel_id: channelId,
      name,
      topic:      container.querySelector('#ch-topic-input').value.trim() || null,
      visibility: visibilitySelect.value,
    } })
    dismiss()
  })
  container.querySelector('#ch-delete-btn').addEventListener('click', () => {
    ws.send({ t: 'channel.delete', body: { channel_id: channelId } })
    dismiss()
  })
  requestAnimationFrame(() => container.querySelector('#ch-name-input')?.focus())
}

function buildCreateHubForm(container, { ws, dismiss }) {
  container.innerHTML = `
    <div class="field">
      <label for="new-hub-name">Hub name</label>
      <input id="new-hub-name" type="text" placeholder="e.g. Engineering" maxlength="80" autocomplete="off">
    </div>
    <div class="field">
      <label for="new-hub-desc">Description <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <input id="new-hub-desc" type="text" maxlength="240" autocomplete="off">
    </div>
    <div class="field">
      <label for="new-hub-visibility">Visibility</label>
      <select id="new-hub-visibility">
        <option value="public">Public — visible to everyone on this instance</option>
        <option value="restricted">Restricted — only added members can see it</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="new-hub-cancel" type="button">Cancel</button>
      <button class="btn-primary" id="new-hub-save" type="button">Create</button>
    </div>
  `
  container.querySelector('#new-hub-cancel').addEventListener('click', dismiss)
  container.querySelector('#new-hub-save').addEventListener('click', () => {
    const name = container.querySelector('#new-hub-name').value.trim()
    if (!name) return
    ws.send({ t: 'hub.create', body: {
      name,
      description: container.querySelector('#new-hub-desc').value.trim() || null,
      visibility:  container.querySelector('#new-hub-visibility').value,
    } })
    dismiss()
  })
  requestAnimationFrame(() => container.querySelector('#new-hub-name')?.focus())
}

function buildCreateChannelForm(container, { hubId, ws, dismiss }) {
  container.innerHTML = `
    <div class="field">
      <label for="new-ch-name">Channel name</label>
      <input id="new-ch-name" type="text" placeholder="e.g. general" maxlength="80" autocomplete="off">
    </div>
    <div class="field">
      <label for="new-ch-topic">Topic <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <input id="new-ch-topic" type="text" maxlength="240" autocomplete="off">
    </div>
    <div class="field">
      <label for="new-ch-visibility">Visibility</label>
      <select id="new-ch-visibility">
        <option value="public">Public — visible to everyone in this hub</option>
        <option value="private">Private — only added members can see it</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="new-ch-cancel" type="button">Cancel</button>
      <button class="btn-primary" id="new-ch-save" type="button">Create</button>
    </div>
  `
  container.querySelector('#new-ch-cancel').addEventListener('click', dismiss)
  container.querySelector('#new-ch-save').addEventListener('click', () => {
    const name = container.querySelector('#new-ch-name').value.trim()
    if (!name) return
    ws.send({ t: 'channel.create', body: {
      hub_id:     hubId,
      kind:       'text',
      name,
      topic:      container.querySelector('#new-ch-topic').value.trim() || null,
      visibility: container.querySelector('#new-ch-visibility').value,
    } })
    dismiss()
  })
  requestAnimationFrame(() => container.querySelector('#new-ch-name')?.focus())
}

// ── Sheet/modal openers ───────────────────────────────────────────────────────

function openCreateHubModal(ws) {
  showModal({
    title: 'New hub',
    build: body => buildCreateHubForm(body, { ws, dismiss: dismissModal })
  })
}

function openCreateHubSheet(ws) {
  showActionSheet({ label: 'New hub', items: [] })
  buildCreateHubForm(getItemsContainer(), { ws, dismiss: dismissSheet })
}

function openHubSheet(hubId, hubName, hubDescription, hubVisibility, ws) {
  showActionSheet({
    label: hubName,
    items: [
      { label: 'Edit hub', action: () => {
          showActionSheet({ label: 'Edit hub', items: [] })
          buildHubForm(getItemsContainer(), { hubId, hubName, hubDescription, hubVisibility, ws, dismiss: dismissSheet })
        }
      },
      { label: 'Create channel', action: () => {
          showActionSheet({ label: `New channel in ${hubName}`, items: [] })
          buildCreateChannelForm(getItemsContainer(), { hubId, ws, dismiss: dismissSheet })
        }
      },
      { label: 'Delete hub', danger: true, action: () => {
          showActionSheet({
            label: `Delete "${hubName}"?`,
            items: [
              { label: 'Cancel', action: () => {} },
              { label: 'Delete hub', danger: true, action: () => {
                  ws.send({ t: 'hub.delete', body: { hub_id: hubId } })
                  dismissSheet()
                }
              }
            ]
          })
        }
      }
    ]
  })
}

function openHubModal(hubId, hubName, hubDescription, hubVisibility, ws) {
  showModal({
    title: 'Hub settings',
    build: body => buildHubForm(body, { hubId, hubName, hubDescription, hubVisibility, ws, dismiss: dismissModal })
  })
}

function openCreateChannelModal(hubId, hubName, ws) {
  showModal({
    title: `New channel in ${hubName}`,
    build: body => buildCreateChannelForm(body, { hubId, ws, dismiss: dismissModal })
  })
}

function openChannelSheet(channelId, channelName, channelTopic, channelVisibility, ws) {
  showActionSheet({
    label: channelName,
    items: [
      { label: 'Edit channel', action: () => {
          showActionSheet({ label: 'Edit channel', items: [] })
          buildChannelForm(getItemsContainer(), { channelId, channelName, channelTopic, channelVisibility, ws, dismiss: dismissSheet })
        }
      },
      { label: 'Delete channel', danger: true, action: () => {
          showActionSheet({
            label: `Delete "#${channelName}"?`,
            items: [
              { label: 'Cancel', action: () => {} },
              { label: 'Delete channel', danger: true, action: () => {
                  ws.send({ t: 'channel.delete', body: { channel_id: channelId } })
                  dismissSheet()
                }
              }
            ]
          })
        }
      }
    ]
  })
}

function openChannelModal(channelId, channelName, channelTopic, channelVisibility, ws) {
  showModal({
    title: 'Channel settings',
    build: body => buildChannelForm(body, { channelId, channelName, channelTopic, channelVisibility, ws, dismiss: dismissModal })
  })
}

// ── Drag-and-drop channel reordering (desktop only) ──────────────────────────

function attachDragHandlers(sidebarEl, { ws, hubs }) {
  // data-key is stripped from template nodes by rdbljs (clearNodeForTemplate removes it),
  // so dataset.key is undefined on re-rendered items. Use getItemContext instead —
  // rdbljs stores { item, key } in a WeakMap on every entry node and it survives re-renders.
  let dragSrcId = null
  let dragHubId = null

  sidebarEl.addEventListener('dragstart', e => {
    const li = e.target.closest('.channel-item')
    if (!li) return
    const ctx = getItemContext(li)
    dragSrcId = ctx?.key ?? null
    dragHubId = ctx?.item?.hub_id ?? null
    if (!dragSrcId) return
    li.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  })

  function clearDropIndicators() {
    sidebarEl.querySelectorAll('.drop-before, .drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after')
    })
  }

  function insertBefore(e, li) {
    return e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2
  }

  sidebarEl.addEventListener('dragend', e => {
    const li = e.target.closest('.channel-item')
    if (li) li.classList.remove('dragging')
    clearDropIndicators()
    dragSrcId = null
    dragHubId = null
  })

  sidebarEl.addEventListener('dragover', e => {
    const li = e.target.closest('.channel-item')
    if (!li || !dragSrcId) return
    const ctx = getItemContext(li)
    if (!ctx || ctx.key === dragSrcId || ctx.item?.hub_id !== dragHubId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    clearDropIndicators()
    li.classList.add(insertBefore(e, li) ? 'drop-before' : 'drop-after')
  })

  sidebarEl.addEventListener('dragleave', e => {
    const li = e.target.closest('.channel-item')
    if (li) { li.classList.remove('drop-before', 'drop-after') }
  })

  sidebarEl.addEventListener('drop', e => {
    const targetLi = e.target.closest('.channel-item')
    if (!targetLi || !dragSrcId || !dragHubId) return
    const targetCtx = getItemContext(targetLi)
    const targetChannelId = targetCtx?.key
    if (!targetChannelId || targetCtx.item?.hub_id !== dragHubId) return
    e.preventDefault()
    clearDropIndicators()

    const hub = hubs().find(h => h.hub_id === dragHubId)
    if (!hub) return

    const ids = (hub.channels ?? []).map(c => c.channel_id)
    const fromIdx = ids.indexOf(dragSrcId)
    const toIdx = ids.indexOf(targetChannelId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return

    const before = insertBefore(e, targetLi)
    ids.splice(fromIdx, 1)
    // After removing the source, find target's new index and insert accordingly
    const newToIdx = ids.indexOf(targetChannelId)
    ids.splice(before ? newToIdx : newToIdx + 1, 0, dragSrcId)

    ws.send({ t: 'channel.reorder', body: { hub_id: dragHubId, channel_ids: ids } })
  })
}

// ── Drag-and-drop hub reordering (desktop only) ───────────────────────────────

function attachHubDragHandlers(sidebarEl, { ws, hubs }) {
  // Uses the same WeakMap-based getItemContext pattern as channel drag handlers.
  // Hub drag targets are details.hub-header elements; draggable="true" is set in the template.
  let dragSrcHubId = null

  function clearDropIndicators() {
    sidebarEl.querySelectorAll('.hub-header.drop-before, .hub-header.drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after')
    })
  }

  function insertBefore(e, details) {
    return e.clientY < details.getBoundingClientRect().top + details.offsetHeight / 2
  }

  sidebarEl.addEventListener('dragstart', e => {
    const details = e.target.closest('.hub-header')
    if (!details) return
    // Ignore if the drag actually started on a channel item inside the hub
    if (e.target.closest('.channel-item')) return
    const ctx = getItemContext(details)
    dragSrcHubId = ctx?.key ?? null
    if (!dragSrcHubId) return
    details.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  })

  sidebarEl.addEventListener('dragend', e => {
    const details = e.target.closest('.hub-header')
    if (details) details.classList.remove('dragging')
    clearDropIndicators()
    dragSrcHubId = null
  })

  sidebarEl.addEventListener('dragover', e => {
    if (!dragSrcHubId) return
    // Ignore drags over channel items — those belong to the channel drag handler
    if (e.target.closest('.channel-item')) return
    const details = e.target.closest('.hub-header')
    if (!details) return
    const ctx = getItemContext(details)
    if (!ctx || ctx.key === dragSrcHubId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    clearDropIndicators()
    details.classList.add(insertBefore(e, details) ? 'drop-before' : 'drop-after')
  })

  sidebarEl.addEventListener('dragleave', e => {
    if (e.target.closest('.channel-item')) return
    const details = e.target.closest('.hub-header')
    if (details) details.classList.remove('drop-before', 'drop-after')
  })

  sidebarEl.addEventListener('drop', e => {
    if (!dragSrcHubId) return
    if (e.target.closest('.channel-item')) return
    const targetDetails = e.target.closest('.hub-header')
    if (!targetDetails) return
    const targetCtx = getItemContext(targetDetails)
    const targetHubId = targetCtx?.key
    if (!targetHubId || targetHubId === dragSrcHubId) return
    e.preventDefault()
    clearDropIndicators()

    const ids = hubs().map(h => h.hub_id)
    const fromIdx = ids.indexOf(dragSrcHubId)
    const toIdx = ids.indexOf(targetHubId)
    if (fromIdx === -1 || toIdx === -1) return

    const before = insertBefore(e, targetDetails)
    ids.splice(fromIdx, 1)
    const newToIdx = ids.indexOf(targetHubId)
    ids.splice(before ? newToIdx : newToIdx + 1, 0, dragSrcHubId)

    ws.send({ t: 'hub.reorder', body: { hub_ids: ids } })
  })
}

// ── File-drop onto channel links ─────────────────────────────────────────────

function attachFileDropHandlers(sidebarEl, { ws }) {
  let hoverTimer  = null
  let hoverTarget = null

  function clearHover() {
    clearTimeout(hoverTimer)
    hoverTimer = null
    if (hoverTarget) {
      hoverTarget.classList.remove('file-drop-hover')
      hoverTarget = null
    }
  }

  function showToast(text) {
    const toast = document.createElement('div')
    toast.className = 'sidebar-toast'
    toast.textContent = text
    sidebarEl.appendChild(toast)
    setTimeout(() => toast.remove(), 3000)
  }

  sidebarEl.addEventListener('dragover', e => {
    const link = e.target.closest('.channel-link')
    if (!link) { clearHover(); return }
    // Only act on file drags (not channel-reordering drags)
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    if (link !== hoverTarget) {
      clearHover()
      hoverTarget = link
      hoverTimer = setTimeout(() => link.classList.add('file-drop-hover'), 600)
    }
  })

  sidebarEl.addEventListener('dragleave', e => {
    if (hoverTarget && !hoverTarget.contains(e.relatedTarget)) clearHover()
  })

  sidebarEl.addEventListener('drop', async e => {
    const link = e.target.closest('.channel-link')
    clearHover()
    if (!link) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()

    const targetChannelId = link.dataset.channelId
    const targetChannelName = link.dataset.channelName ?? targetChannelId
    if (!targetChannelId) return

    const files = [...e.dataTransfer.files]
    if (files.length === 0) return

    // Join the channel first (needed for delivery cursor)
    ws.send({ t: 'channel.join', body: { channel_id: targetChannelId } })

    const uploaded = []
    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('channel_id', targetChannelId)
      try {
        const res = await fetch(`${window.__BASE_PATH__}/api/uploads`, { method: 'POST', body: formData })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          showToast(`Upload failed: ${body.error ?? res.statusText}`)
          continue
        }
        const a = await res.json()
        uploaded.push({
          upload_id: a.upload_id,
          url: a.url,
          filename: a.original_name,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
        })
      } catch {
        showToast('Upload failed: network error')
      }
    }

    if (uploaded.length === 0) return

    ws.send({
      t: 'msg.send',
      body: {
        channel_id: targetChannelId,
        text: '',
        client_msg_id: `drop_${Date.now()}`,
        attachments: uploaded,
      }
    })

    showToast(`Sent to #${targetChannelName}`)
  })
}

// ── Attach management handlers (event delegation — safe across re-renders) ───

function attachManagementHandlers(sidebarEl, { ws, hubs }) {
  // Gear buttons and add button: single delegated click listener
  sidebarEl.addEventListener('click', e => {
    // Hub gear
    if (e.target.closest('.btn-hub-gear')) {
      e.stopPropagation()
      const summary = e.target.closest('.hub-name')
      const hubId = summary?.dataset.hubId
      if (!hubId) return
      const hub = hubs().find(h => h.hub_id === hubId)
      openHubModal(hubId, hub?.name ?? '', hub?.description ?? null, hub?.visibility ?? 'public', ws)
      return
    }

    // Hub add-channel button
    if (e.target.closest('.btn-hub-add')) {
      e.stopPropagation()
      const summary = e.target.closest('.hub-name')
      const hubId = summary?.dataset.hubId
      if (!hubId) return
      const hub = hubs().find(h => h.hub_id === hubId)
      openCreateChannelModal(hubId, hub?.name ?? '', ws)
      return
    }

    // Channel gear
    if (e.target.closest('.btn-channel-gear')) {
      e.preventDefault()
      const li = e.target.closest('.channel-item')
      const link = li?.querySelector('.channel-link')
      const channelId = link?.dataset.channelId
      if (!channelId) return
      let ch = null
      for (const hub of hubs()) {
        ch = (hub.channels ?? []).find(c => c.channel_id === channelId)
        if (ch) break
      }
      openChannelModal(channelId, ch?.name ?? '', ch?.topic ?? null, ch?.visibility ?? 'public', ws)
      return
    }
  })

  // Touch: long-press delegation on the sidebar
  if (isTouch()) {
    addLongPress(sidebarEl, (e) => {
      const target = e.target ?? e.touches?.[0]?.target

      // Long-press on hub summary
      const summary = target?.closest?.('.hub-name')
      if (summary) {
        const hubId = summary.dataset.hubId
        if (!hubId) return
        const hub = hubs().find(h => h.hub_id === hubId)
        openHubSheet(hubId, hub?.name ?? '', hub?.description ?? null, hub?.visibility ?? 'public', ws)
        return
      }

      // Long-press on channel link
      const link = target?.closest?.('.channel-link')
      if (link) {
        const channelId = link.dataset.channelId
        if (!channelId) return
        let ch = null
        for (const hub of hubs()) {
          ch = (hub.channels ?? []).find(c => c.channel_id === channelId)
          if (ch) break
        }
        openChannelSheet(channelId, ch?.name ?? '', ch?.topic ?? null, ch?.visibility ?? 'public', ws)
      }
    })
  }
}

// ── Navigation after deletion ─────────────────────────────────────────────────

function navigateAfterDeletion(remainingHubs) {
  const first = remainingHubs.flatMap(h => h.channels ?? []).find(Boolean)
  window.location.href = first ? `${window.__BASE_PATH__}/channels/${first.channel_id}` : `${window.__BASE_PATH__}/`
}

// ── Island ────────────────────────────────────────────────────────────────────

function populateDmsFromDom(root) {
  return Array.from(root.querySelectorAll('.dm-item')).map(li => ({
    channel_id: li.dataset.channelId,
    with_user: { display_name: li.querySelector('.dm-name')?.textContent.trim() ?? '' }
  }))
}

export default function SidebarIsland(root) {
  let currentChannelId = root.dataset.currentchannel
  const currentUserId = root.dataset.userid ?? null
  const hubs = signal(populateFromDom(root))
  const dms = signal(populateDmsFromDom(root))
  // channelId → true if this channel has an unread @mention
  const mentionedChannels = signal(new Set())
  // channelId → true if this channel has an unread urgent (@mention + now priority)
  const urgentChannels = signal(new Set())
  const dmUnread = signal(new Set())
  const ws = new WsClient(`${window.__BASE_PATH__}/ws`)

  ws.on('hub.created', ({ hub }) => {
    hubs.set([...hubs(), { ...hub, channels: [] }])
  })

  ws.on('hub.updated', ({ hub }) => {
    hubs.set(hubs().map(h => h.hub_id === hub.hub_id ? { ...h, ...hub } : h))
  })

  ws.on('notification.mention', ({ channel_id, priority }) => {
    if (channel_id === currentChannelId) return // already viewing — no dot needed
    if (priority === 'now') {
      const next = new Set(urgentChannels())
      next.add(channel_id)
      urgentChannels.set(next)
    } else {
      const next = new Set(mentionedChannels())
      next.add(channel_id)
      mentionedChannels.set(next)
    }
  })

  ws.on('notification.digest', ({ channels }) => {
    if (!channels?.length) return
    const nextMentioned = new Set(mentionedChannels())
    const nextUrgent = new Set(urgentChannels())
    for (const c of channels) {
      if (c.urgent) nextUrgent.add(c.channel_id)
      else if (c.mentions > 0) nextMentioned.add(c.channel_id)
    }
    mentionedChannels.set(nextMentioned)
    urgentChannels.set(nextUrgent)
  })

  ws.on('hub.member_added', ({ hub_id, user_id }) => {
    if (user_id !== currentUserId) return
    // Current user was added to a hub — fetch the hub list and merge new hubs in
    ws.once('hub.list_result', ({ hubs: serverHubs }) => {
      const existing = new Set(hubs().map(h => h.hub_id))
      const newHubs = serverHubs.filter(h => !existing.has(h.hub_id))
      if (newHubs.length > 0) {
        hubs.set([...hubs(), ...newHubs.map(h => ({ ...h, channels: [] }))])
      }
    })
    ws.send({ t: 'hub.list', body: {} })
  })

  ws.on('hub.member_removed', ({ hub_id, user_id }) => {
    if (user_id !== currentUserId) return
    // Current user was removed from a hub — drop it from the signal
    const removedHub = hubs().find(h => h.hub_id === hub_id)
    const affectsCurrentChannel = (removedHub?.channels ?? []).some(c => c.channel_id === currentChannelId)
    hubs.set(hubs().filter(h => h.hub_id !== hub_id))
    if (affectsCurrentChannel) navigateAfterDeletion(hubs())
  })

  ws.on('dm.list_result', ({ dms: list }) => {
    dms.set(list)
  })

  ws.on('dm.opened', ({ channel_id, with_user, notify_only }) => {
    // Add to DM list if not already present
    if (!dms().some(d => d.channel_id === channel_id)) {
      dms.set([{ channel_id, with_user }, ...dms()])
    }
    if (notify_only) {
      // Target user — show unread dot, don't navigate
      const next = new Set(dmUnread()); next.add(channel_id); dmUnread.set(next)
    } else {
      // Initiating user — navigate to the DM channel
      window.location.href = `${window.__BASE_PATH__}/channels/${channel_id}`
    }
  })

  // Highlight DM list item when a message arrives in a DM channel not currently open
  ws.on('msg.event', ({ channel_id }) => {
    if (channel_id === currentChannelId) return
    if (!dms().some(d => d.channel_id === channel_id)) return
    const next = new Set(dmUnread()); next.add(channel_id); dmUnread.set(next)
  })

  // Clear dot when user clicks a DM link
  root.addEventListener('click', e => {
    const link = e.target.closest('.dm-link')
    if (!link) return
    const id = link.dataset.channelId
    if (id) { const next = new Set(dmUnread()); next.delete(id); dmUnread.set(next) }
  })

  // Track current channel across SPA navigations and clear DM dot when landing on a DM
  document.addEventListener('chatpanel:navigated', e => {
    const { channelId: newId } = e.detail
    const prevId = currentChannelId
    currentChannelId = newId
    // Only create new objects for hubs/channels that actually changed (prev active → new
    // active). Returning the same object reference for unchanged hubs lets rdbljs skip
    // destroying and recreating those DOM rows, which prevents a brief empty-sidebar flash
    // on iOS during the CSS transition animation.
    if (prevId !== newId) {
      hubs.set(hubs().map(h => {
        const channels = h.channels ?? []
        const affected = channels.some(c => c.channel_id === newId || c.channel_id === prevId)
        if (!affected) return h  // same reference — rdbljs skips this hub entirely
        return {
          ...h,
          channels: channels.map(c => {
            if (c.channel_id !== newId && c.channel_id !== prevId) return c
            const base = (c.className ?? 'channel-item').replace(/\bactive\b/g, '').trim()
            const next = c.channel_id === newId ? `${base} active` : base
            return next === c.className ? c : { ...c, className: next }
          })
        }
      }))
    }
    if (dmUnread().has(newId)) {
      const next = new Set(dmUnread()); next.delete(newId); dmUnread.set(next)
    }
    if (meetingUnread().has(newId)) {
      const next = new Set(meetingUnread()); next.delete(newId); meetingUnread.set(next)
    }
    // Always re-render meetings so the selected highlight tracks the current channel,
    // regardless of whether the unread signal changed.
    renderMeetings()
  })

  ws.on('hub.reordered', ({ hubs: updated }) => {
    // Merge server-authoritative order into local state, preserving loaded channel arrays
    const channelMap = new Map(hubs().map(h => [h.hub_id, h.channels]))
    hubs.set(updated.map(h => ({ ...h, channels: channelMap.get(h.hub_id) ?? [] })))
  })

  ws.on('hub.deleted', ({ hub_id }) => {
    const deletedHub = hubs().find(h => h.hub_id === hub_id)
    const affectsCurrentChannel = (deletedHub?.channels ?? []).some(c => c.channel_id === currentChannelId)
    hubs.set(hubs().filter(h => h.hub_id !== hub_id))
    if (affectsCurrentChannel) navigateAfterDeletion(hubs())
  })

  ws.on('channel.created', ({ channel }) => {
    hubs.set(hubs().map(h => {
      if (h.hub_id !== channel.hub_id) return h
      const channels = [...(h.channels ?? []), {
        ...channel,
        url: `${window.__BASE_PATH__}/channels/${channel.channel_id}`,
        label: `# ${channel.name}`,
        className: 'channel-item'
      }]
      return { ...h, channels }
    }))
  })

  ws.on('channel.updated', ({ channel }) => {
    hubs.set(hubs().map(h => {
      if (h.hub_id !== channel.hub_id) return h
      return {
        ...h,
        channels: (h.channels ?? []).map(c =>
          c.channel_id === channel.channel_id
            ? { ...c, ...channel, label: `# ${channel.name}` }
            : c
        )
      }
    }))
  })

  ws.on('channel.reordered', ({ hub_id, channels }) => {
    hubs.set(hubs().map(h => {
      if (h.hub_id !== hub_id) return h
      const channelMap = new Map((h.channels ?? []).map(c => [c.channel_id, c]))
      const reordered = channels.map(c => ({ ...channelMap.get(c.channel_id), ...c, url: `${window.__BASE_PATH__}/channels/${c.channel_id}` }))
      return { ...h, channels: reordered }
    }))
  })

  ws.on('channel.deleted', ({ channel_id }) => {
    const wasCurrentChannel = channel_id === currentChannelId
    hubs.set(hubs().map(h => ({
      ...h,
      channels: (h.channels ?? []).filter(c => c.channel_id !== channel_id)
    })))
    if (wasCurrentChannel) navigateAfterDeletion(hubs())
  })

  // Channel link clicks: dispatch channelnavigated + mobile sidebar hide + clear mention dot
  root.addEventListener('click', e => {
    const link = e.target.closest('.channel-link')
    if (!link) return
    const clickedChannelId = link.dataset.channelId
    document.dispatchEvent(new CustomEvent('channelnavigated', {
      detail: { channelId: clickedChannelId }
    }))
    // Clear mention/urgent dot for this channel
    if (clickedChannelId && (mentionedChannels().has(clickedChannelId) || urgentChannels().has(clickedChannelId))) {
      const nextMentioned = new Set(mentionedChannels())
      const nextUrgent = new Set(urgentChannels())
      nextMentioned.delete(clickedChannelId)
      nextUrgent.delete(clickedChannelId)
      mentionedChannels.set(nextMentioned)
      urgentChannels.set(nextUrgent)
    }
    if (window.matchMedia('(max-width: 700px)').matches) {
      document.body.classList.remove('sidebar-open')
    }
  })

  // Mention dot management.
  // Uses data-mention / data-urgent attributes instead of CSS classes so that
  // rdbljs className re-renders (el.className = ...) never wipe the dot state.
  function updateMentionDots() {
    const mentioned = mentionedChannels()
    const urgent = urgentChannels()
    root.querySelectorAll('.channel-item').forEach(li => {
      const link = li.querySelector('.channel-link')
      const channelId = link?.dataset.channelId
      if (!channelId) return
      if (urgent.has(channelId)) {
        li.dataset.urgent = ''
        delete li.dataset.mention
      } else if (mentioned.has(channelId)) {
        li.dataset.mention = ''
        delete li.dataset.urgent
      } else {
        delete li.dataset.mention
        delete li.dataset.urgent
      }
    })
  }
  effect(() => updateMentionDots())

  // Avatar cache — populated from user.list_result and kept current by user.avatar_updated
  const avatarCache = signal(new Map())

  // DMs — computed display items consumed by the each= template in the sidebar HTML
  const dmsDisplay = computed(() => {
    const unread = dmUnread()
    const cache = avatarCache()
    return dms().map(d => {
      const userId = d.with_user?.user_id ?? d.channel_id
      const displayName = d.with_user?.display_name ?? ''
      const cached = cache.get(userId)
      const chars = (cached?.avatar_chars != null ? cached.avatar_chars : null) || initials(displayName, '') || '?'
      const colorIdx = cached?.avatar_color != null ? Number(cached.avatar_color) : null
      const { bg, fg } = colorIdx != null && PALETTE[colorIdx] ? PALETTE[colorIdx] : colorFromId(userId)
      return {
        channel_id: d.channel_id,
        userId,
        displayName: displayName || d.channel_id,
        href: `${window.__BASE_PATH__}/channels/${d.channel_id}`,
        itemClass: 'dm-item' + (d.channel_id === currentChannelId ? ' dm-selected' : ''),
        mention: unread.has(d.channel_id) ? '' : null,
        avatarStyle: `width:24px;height:24px;background:${bg};color:${fg};font-size:10px`,
        avatarChars: chars,
      }
    })
  })
  const dmsEmpty = computed(() => dms().length === 0)

  // Fetch DM list as soon as the socket opens — the connection is already
  // authenticated via the session cookie at upgrade time, so no hello needed.
  ws.on('open', () => {
    ws.send({ t: 'dm.list', body: {} })
    ws.send({ t: 'meeting.list', body: {} })
    ws.send({ t: 'user.list', body: {} })
  })

  ws.on('user.list_result', ({ users }) => {
    const next = new Map(avatarCache())
    for (const u of users ?? []) {
      next.set(u.user_id, { avatar_chars: u.avatar_chars ?? null, avatar_color: u.avatar_color ?? null })
    }
    avatarCache.set(next)
  })

  ws.on('user.avatar_updated', ({ user_id, avatar_chars, avatar_color }) => {
    const next = new Map(avatarCache())
    next.set(user_id, { avatar_chars, avatar_color })
    avatarCache.set(next)
  })

  // ── Meetings ───────────────────────────────────────────────────────────────

  const meetings = signal([])
  const meetingUnread = signal(new Set())

  // Meetings — flattened list: each root meeting followed by its segments as children.
  // Segments dispatch a scroll event rather than navigating to a new channel.
  const meetingsDisplay = computed(() => {
    const list = meetings()
    const unread = meetingUnread()
    const result = []
    for (const m of list) {
      const isActive = m.channel_id === currentChannelId
      result.push({
        item_key: m.channel_id,
        channel_id: m.channel_id,
        name: m.name,
        href: `${window.__BASE_PATH__}/channels/${m.channel_id}`,
        itemClass: 'meeting-item' + (isActive ? ' dm-selected' : ''),
        mention: unread.has(m.channel_id) ? '' : null,
        indentStyle: null,
        isChild: null,
        ended_at: m.ended_at || null,
        divider_msg_id: null,
      })
      for (const seg of m.segments ?? []) {
        result.push({
          item_key: `${m.channel_id}:seg:${seg.id}`,
          channel_id: m.channel_id,
          name: seg.name,
          href: `${window.__BASE_PATH__}/channels/${m.channel_id}`,
          itemClass: 'meeting-item meeting-item--child' + (isActive ? ' dm-selected' : ''),
          mention: null,
          indentStyle: 'padding-left:12px',
          isChild: true,
          ended_at: seg.ended_at ?? null,
          divider_msg_id: seg.divider_msg_id,
        })
      }
    }
    return result
  })
  const meetingsEmpty = computed(() => meetings().length === 0)

  // Meeting link clicks:
  // - Root meetings navigate normally.
  // - Segment children (have data-divider-msg-id) scroll to the divider in the current
  //   view if already on that channel, or navigate and hand off via sessionStorage.
  root.addEventListener('click', e => {
    const link = e.target.closest('.meeting-link')
    if (!link) return
    const channelId = link.dataset.channelId
    const dividerMsgId = link.dataset.dividerMsgId

    // Clear unread dot
    if (channelId && meetingUnread().has(channelId)) {
      const next = new Set(meetingUnread()); next.delete(channelId); meetingUnread.set(next)
    }

    if (dividerMsgId) {
      e.preventDefault()
      if (channelId === currentChannelId) {
        // Already on the meeting channel — just scroll
        document.dispatchEvent(new CustomEvent('meeting:scroll-to-msg', { detail: { msgId: dividerMsgId } }))
      } else {
        // Navigate to the meeting channel and scroll after load
        sessionStorage.setItem('meeting:scroll-to-msg', dividerMsgId)
        window.location.href = link.href
      }
    }
  })

  ws.on('meeting.list_result', ({ meetings: list }) => {
    meetings.set(list)
  })

  ws.on('meeting.created', ({ meeting }) => {
    if (!meetings().some(m => m.channel_id === meeting.channel_id)) {
      meetings.set([meeting, ...meetings()])
    }
    window.location.href = `${window.__BASE_PATH__}/channels/${meeting.channel_id}`
  })

  ws.on('meeting.closed', ({ channel_id, ended_at, segments }) => {
    meetings.set(meetings().map(m => {
      if (m.channel_id !== channel_id) return m
      return { ...m, ended_at, segments: segments ?? m.segments }
    }))
  })

  ws.on('meeting.continued', ({ channel_id, segment, closed_segment }) => {
    meetings.set(meetings().map(m => {
      if (m.channel_id !== channel_id) return m
      const segs = m.segments ?? []
      // Update the previous segment's ended_at if one was closed
      const updatedSegs = closed_segment
        ? segs.map(s => s.id === closed_segment.id ? { ...s, ended_at: closed_segment.ended_at } : s)
        : [...segs]
      if (updatedSegs.some(s => s.id === segment.id)) return { ...m, segments: updatedSegs }
      return { ...m, ended_at: m.ended_at ?? segment.created_at, segments: [...updatedSegs, segment] }
    }))
  })

  // Received when another user invites us to a meeting
  ws.on('meeting.invited', ({ meeting }) => {
    if (!meetings().some(m => m.channel_id === meeting.channel_id)) {
      meetings.set([meeting, ...meetings()])
    }
    const next = new Set(meetingUnread()); next.add(meeting.channel_id); meetingUnread.set(next)
  })

  function buildMeetingForm(container, { ws, dismiss }) {
    // selectedAttendees: Map<user_id, { user_id, display_name, email }>
    const selectedAttendees = new Map()

    container.innerHTML = `
      <div class="field">
        <label for="meeting-name-input">Meeting name</label>
        <input id="meeting-name-input" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Sprint Review">
      </div>
      <div class="field">
        <label>Invite attendees</label>
        <div class="attendee-chips" id="attendee-chips"></div>
        <div class="attendee-search-wrap">
          <input id="attendee-search" type="text" autocomplete="off" placeholder="Search by name, handle or email…">
          <ul class="attendee-dropdown" id="attendee-dropdown" hidden></ul>
        </div>
      </div>
      <div class="field">
        <label for="meeting-scheduled-input">Scheduled time <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input id="meeting-scheduled-input" type="datetime-local">
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" id="meeting-cancel-btn" type="button">Cancel</button>
        <button class="btn-primary" id="meeting-save-btn" type="button">Create</button>
      </div>
    `

    const chipsEl    = container.querySelector('#attendee-chips')
    const searchEl   = container.querySelector('#attendee-search')
    const dropdownEl = container.querySelector('#attendee-dropdown')

    function renderChips() {
      chipsEl.innerHTML = [...selectedAttendees.values()].map(u => `
        <span class="attendee-chip" data-uid="${escHtml(u.user_id)}">
          ${escHtml(u.display_name)}
          <button class="chip-remove" type="button" aria-label="Remove ${escHtml(u.display_name)}">×</button>
        </span>
      `).join('')
    }

    chipsEl.addEventListener('click', e => {
      const btn = e.target.closest('.chip-remove')
      if (!btn) return
      const uid = btn.closest('.attendee-chip').dataset.uid
      selectedAttendees.delete(uid)
      renderChips()
    })

    function showDropdown(users) {
      if (users.length === 0) { dropdownEl.hidden = true; return }
      dropdownEl.innerHTML = users.map(u => `
        <li class="attendee-option" data-uid="${escHtml(u.user_id)}"
            data-name="${escHtml(u.display_name)}" data-email="${escHtml(u.email ?? '')}">
          <span class="attendee-option-name">${escHtml(u.display_name)}</span>
          <span class="attendee-option-handle">@${escHtml(u.handle)}</span>
        </li>
      `).join('')
      dropdownEl.hidden = false
    }

    dropdownEl.addEventListener('mousedown', e => {
      // mousedown fires before blur — prevent search input losing focus prematurely
      e.preventDefault()
      const li = e.target.closest('.attendee-option')
      if (!li) return
      selectedAttendees.set(li.dataset.uid, {
        user_id: li.dataset.uid,
        display_name: li.dataset.name,
        email: li.dataset.email,
      })
      renderChips()
      searchEl.value = ''
      dropdownEl.hidden = true
      searchEl.focus()
    })

    // Pending WS request id so we can ignore stale results
    let pendingSearchId = null
    let searchTimer = null

    function doSearch(q) {
      if (!q.trim()) { dropdownEl.hidden = true; return }
      const id = `user-search-${Date.now()}`
      pendingSearchId = id
      ws.send({ t: 'user.search', id, body: { q } })
    }

    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => doSearch(searchEl.value), 200)
    })

    searchEl.addEventListener('blur', () => { dropdownEl.hidden = true })
    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { dropdownEl.hidden = true; searchEl.value = '' }
    })

    // One-time listener that forwards search results into the dropdown.
    // We keep it alive for the duration of the form (cleaned up when form is torn down).
    function onSearchResult({ users, _replyTo }) {
      // Filter out already-selected users
      const filtered = users.filter(u => !selectedAttendees.has(u.user_id))
      showDropdown(filtered)
    }
    ws.on('user.search_result', onSearchResult)

    // Cleanup listener when the form is dismissed
    const origDismiss = dismiss
    dismiss = () => { ws.off('user.search_result', onSearchResult); origDismiss() }

    container.querySelector('#meeting-cancel-btn').addEventListener('click', dismiss)
    container.querySelector('#meeting-save-btn').addEventListener('click', () => {
      const name = container.querySelector('#meeting-name-input').value.trim()
      if (!name) { container.querySelector('#meeting-name-input').focus(); return }
      const attendee_user_ids = [...selectedAttendees.values()].map(u => u.user_id)
      const scheduledRaw = container.querySelector('#meeting-scheduled-input').value
      const scheduled_at = scheduledRaw ? new Date(scheduledRaw).toISOString() : null
      ws.send({ t: 'meeting.create', body: { name, attendee_user_ids, scheduled_at } })
      dismiss()
    })

    container.querySelector('#meeting-name-input').focus()
  }

  function openCreateMeetingModal(ws) {
    showModal({ title: 'New meeting', build: body => buildMeetingForm(body, { ws, dismiss: dismissModal }) })
  }

  function openCreateMeetingSheet(ws) {
    showActionSheet({ label: 'New meeting', items: [] })
    buildMeetingForm(getItemsContainer(), { ws, dismiss: dismissSheet })
  }

  root.querySelector('#btn-new-meeting')?.addEventListener('click', () => {
    isTouch() ? openCreateMeetingSheet(ws) : openCreateMeetingModal(ws)
  })

  // New hub button
  root.querySelector('#btn-new-hub')?.addEventListener('click', () => {
    isTouch() ? openCreateHubSheet(ws) : openCreateHubModal(ws)
  })

  // Wire management handlers (event delegation — attached once, survives re-renders)
  attachManagementHandlers(root, { ws, hubs })

  // Wire drag-and-drop reordering (desktop only — touch uses action sheet)
  attachDragHandlers(root, { ws, hubs })
  attachHubDragHandlers(root, { ws, hubs })

  // Wire file-drop onto channel links
  attachFileDropHandlers(root, { ws })

  // ── Web Push subscription ─────────────────────────────────────────────────
  // Browsers require a user gesture to call Notification.requestPermission().
  // Strategy: show a small "Enable notifications" button in the sidebar footer.
  // It appears when VAPID is configured + browser supports push + permission is
  // 'default'. Clicking it (user gesture) requests permission then subscribes.
  const vapidKey = root.dataset.vapidKey ?? ''
  if (vapidKey && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    function vapidKeyToUint8Array(b64url) {
      const padded = b64url + '==='.slice((b64url.length + 3) % 4)
      const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
      return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    }

    async function subscribeToPush(swReg) {
      try {
        const sub = await swReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyToUint8Array(vapidKey),
        })
        ws.send({ t: 'push.subscribe', body: { subscription: sub.toJSON() } })
      } catch { /* subscribe failed or user blocked — ignore */ }
    }

    // Register SW once and hold a reference for later use.
    // After registration, probe pushManager to confirm push actually works in
    // this browser context — Safari Private windows register a SW fine but
    // silently refuse push subscriptions, so we skip the button there.
    let swReg = null
    navigator.serviceWorker.register(`${window.__BASE_PATH__}/sw.js`, { scope: `${window.__BASE_PATH__}/` })
      .then(async reg => {
        swReg = reg
        // Confirm push is functional by checking the subscription API
        try { await reg.pushManager.getSubscription() } catch {
          return // push not available in this context (e.g. Safari Private)
        }
        if (Notification.permission === 'granted') subscribeToPush(reg)
        if (Notification.permission !== 'granted') showEnableButton()
      })
      .catch(() => { /* http in dev, or SW blocked entirely */ })

    // Inject a small "Enable notifications" button into the sidebar footer.
    // This is the only place we can legally call requestPermission() — inside
    // a synchronous click handler (user gesture).
    //
    // Three states:
    //   'default' → clickable, opens browser permission dialog
    //   'denied'  → non-clickable, tells user to update browser settings
    //   'granted' → button is removed entirely
    let enableBtn = null

    function updateEnableButton() {
      if (!enableBtn) return
      const perm = Notification.permission
      if (perm === 'granted') {
        enableBtn.remove()
        enableBtn = null
        return
      }
      if (perm === 'denied') {
        enableBtn.textContent = '🔕 Notifications blocked in browser settings'
        enableBtn.dataset.blocked = 'true'
      } else {
        enableBtn.textContent = '🔔 Enable notifications'
        delete enableBtn.dataset.blocked
      }
    }

    function showEnableButton() {
      if (enableBtn) return
      enableBtn = document.createElement('button')
      enableBtn.className = 'btn-enable-push'
      enableBtn.type = 'button'
      enableBtn.addEventListener('click', async () => {
        if (enableBtn.dataset.blocked) return   // denied — browser won't show dialog
        const permission = await Notification.requestPermission()
        updateEnableButton()
        if (permission === 'granted' && swReg) subscribeToPush(swReg)
      })
      root.querySelector('.sidebar-footer')?.prepend(enableBtn)
      updateEnableButton()
    }
  }

  // ── Footer avatar ──────────────────────────────────────────────────────────

  const footerUsernameEl = root.querySelector('.sidebar-username')
  if (footerUsernameEl) {
    const userId      = root.dataset.userid ?? ''
    const displayName = root.dataset.displayname || footerUsernameEl.textContent.trim()
    const handle      = root.dataset.handle ?? ''

    // Seed avatar state: SSR (baked from DB on this request) is most reliable.
    // Fall back to localStorage in case syncToServer hadn't finished before the reload.
    // Neither source is read again after mount — in-session changes update sessionAvatarChars/Color directly.
    const lsSettings    = getSettings()
    const ssrChars      = root.dataset.avatarChars || null
    const ssrColor      = root.dataset.avatarColor !== '' ? Number(root.dataset.avatarColor) : null
    let sessionAvatarChars = ssrChars
      ?? (lsSettings.avatar_chars != null ? lsSettings.avatar_chars : null)
    let sessionAvatarColor = ssrColor
      ?? (lsSettings.avatar_color != null ? Number(lsSettings.avatar_color) : null)

    function buildFooterAvatar() {
      return renderAvatar({ userId, displayName, handle, avatarChars: sessionAvatarChars, avatarColor: sessionAvatarColor, size: 30 })
    }

    const avatarBtn = document.createElement('button')
    avatarBtn.type = 'button'
    avatarBtn.className = 'sidebar-avatar-btn'
    avatarBtn.title = 'Edit your avatar'
    avatarBtn.setAttribute('aria-label', 'Edit your avatar')
    avatarBtn.innerHTML = buildFooterAvatar()
    footerUsernameEl.before(avatarBtn)

    // ── Avatar editor popover ────────────────────────────────────────────────
    const editorEl = document.createElement('div')
    editorEl.className = 'avatar-editor'
    editorEl.hidden = true
    editorEl.innerHTML = `
      <div class="avatar-editor-header">Edit avatar</div>
      <label class="avatar-editor-label">
        Letters (1-2)
        <input class="avatar-editor-chars" type="text" maxlength="2" placeholder="Auto" value="${escHtml(sessionAvatarChars || initials(displayName, handle))}">
      </label>
      <div class="avatar-editor-label">Color</div>
      <div class="avatar-editor-palette"></div>
      <button class="btn-ghost btn-sm avatar-editor-save" type="button">Save</button>
    `
    footerUsernameEl.closest('.sidebar-footer-controls')?.appendChild(editorEl)

    // Populate palette swatches
    const paletteEl = editorEl.querySelector('.avatar-editor-palette')
    PALETTE.forEach(({ bg, fg }, idx) => {
      const sw = document.createElement('button')
      sw.type = 'button'
      sw.className = 'avatar-swatch'
      sw.style.cssText = `background:${bg};color:${fg}`
      sw.dataset.index = idx
      sw.setAttribute('aria-label', `Color ${idx + 1}`)
      paletteEl.appendChild(sw)
    })

    let selectedColor = sessionAvatarColor
    const charsInput = editorEl.querySelector('.avatar-editor-chars')

    function openEditor() {
      charsInput.value = sessionAvatarChars || initials(displayName, handle)
      selectedColor = sessionAvatarColor
      paletteEl.querySelectorAll('.avatar-swatch').forEach(sw => {
        sw.classList.toggle('avatar-swatch--selected', Number(sw.dataset.index) === selectedColor)
      })
      editorEl.hidden = false
      charsInput.focus()
      charsInput.select()
    }

    function saveAndClose() {
      const raw = charsInput.value.trim().slice(0, 2).toUpperCase()
      sessionAvatarChars = raw || null
      sessionAvatarColor = selectedColor
      patchSettings({ avatar_chars: sessionAvatarChars, avatar_color: sessionAvatarColor })
      ws.send({ t: 'user.avatar_updated', body: { avatar_chars: sessionAvatarChars, avatar_color: sessionAvatarColor } })
      avatarBtn.innerHTML = buildFooterAvatar()
      editorEl.hidden = true

      // Refresh every avatar in the page that belongs to this user
      document.querySelectorAll(`.avatar[data-user-id="${CSS.escape(userId)}"]`).forEach(span => {
        const size = parseInt(span.style.width) || 28
        const newHtml = renderAvatar({ userId, displayName, handle, avatarChars: sessionAvatarChars, avatarColor: sessionAvatarColor, size })
        span.insertAdjacentHTML('afterend', newHtml)
        span.remove()
      })
    }

    avatarBtn.addEventListener('click', () => {
      if (editorEl.hidden) openEditor()
      else saveAndClose()
    })

    paletteEl.addEventListener('click', e => {
      const sw = e.target.closest('.avatar-swatch')
      if (!sw) return
      selectedColor = Number(sw.dataset.index)
      paletteEl.querySelectorAll('.avatar-swatch').forEach(s => s.classList.remove('avatar-swatch--selected'))
      sw.classList.add('avatar-swatch--selected')
    })

    editorEl.querySelector('.avatar-editor-save').addEventListener('click', saveAndClose)

    // Save and close when clicking outside the editor
    document.addEventListener('click', e => {
      if (!editorEl.hidden && !editorEl.contains(e.target) && !avatarBtn.contains(e.target)) {
        saveAndClose()
      }
    })
  }

  return { hubs, dmsDisplay, dmsEmpty, meetingsDisplay, meetingsEmpty }
}
