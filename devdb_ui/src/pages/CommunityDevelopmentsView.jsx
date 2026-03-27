// CommunityDevelopmentsView.jsx
// Developments tab: assign developments to communities via drag-drop.
// Layout: [Unassigned Devs panel 168px] [Alphabet slider + Community pills]

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import Toast from '../components/Toast'

// ---------------------------------------------------------------------------
// DevCard — draggable development card
// ---------------------------------------------------------------------------
function DevCard({ dev, isPending, isOverlay = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `dev-${dev.dev_id}`,
    data: { type: 'development', dev },
    disabled: isPending || isOverlay,
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: (isDragging && !isOverlay) || isPending ? 0.35 : 1,
        cursor: isPending ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
        padding: '4px 8px',
        border: `1px solid ${isDragging && !isOverlay ? '#93c5fd' : '#e2e8f0'}`,
        borderRadius: 6,
        background: '#ffffff',
        userSelect: 'none',
        touchAction: 'none',
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, color: '#1f2937', lineHeight: 1.4 }}>
        {dev.dev_name}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.3 }}>
        {dev.marks_code ?? '—'}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UnassignedDevsPanel — droppable full-height left panel
// ---------------------------------------------------------------------------
function UnassignedDevsPanel({ devs, pendingDevId }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'unassigned-devs',
    data: { type: 'unassigned-devs' },
  })

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col h-full transition-colors ${isOver ? 'bg-blue-50' : 'bg-gray-50'}`}
    >
      <div
        className={`px-2 py-2 border-b flex-shrink-0 transition-colors ${
          isOver ? 'border-blue-300 bg-blue-100' : 'border-gray-200 bg-gray-100'
        }`}
      >
        <p className={`font-bold text-sm truncate ${isOver ? 'text-blue-900' : 'text-gray-700'}`}>
          Unassigned Devs
        </p>
        <p className={`text-[11px] mt-0.5 ${isOver ? 'text-blue-600' : 'text-gray-500'}`}>
          {devs.length > 0
            ? `${devs.length} dev${devs.length === 1 ? '' : 's'}`
            : 'empty'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 p-2 min-h-0">
        {devs.length > 0 ? (
          devs.map((dev) => (
            <DevCard key={dev.dev_id} dev={dev} isPending={pendingDevId === dev.dev_id} />
          ))
        ) : (
          <p className={`text-[11px] italic text-center mt-2 ${isOver ? 'text-blue-600' : 'text-gray-400'}`}>
            {isOver ? 'Drop to unassign' : 'All assigned'}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommunityPill — droppable community card with nested dev cards
// innerRef: callback ref so parent can track DOM node for scroll-to-selected
// ---------------------------------------------------------------------------
function CommunityPill({ community, devs, isSelected, pendingDevId, innerRef }) {
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `community-${community.ent_group_id}`,
    data: { type: 'community-target', communityId: community.ent_group_id },
  })

  function setRef(el) {
    setDropRef(el)
    innerRef?.(el)
  }

  return (
    <div
      ref={setRef}
      className="rounded-lg border transition-colors duration-100 overflow-hidden"
      style={{
        width: '100%',
        breakInside: 'avoid',
        borderColor: isSelected ? '#3b82f6' : isOver ? '#93c5fd' : '#cbd5e1',
        background: isSelected ? '#eff6ff' : isOver ? '#e8f4ff' : '#f0f4f8',
      }}
    >
      {/* Pill header */}
      <div
        className="flex-shrink-0 px-3 py-2 border-b transition-colors"
        style={{
          borderColor: isSelected ? '#bfdbfe' : '#cbd5e1',
          background: isSelected ? '#dbeafe' : '#dde6f0',
          borderRadius: '6px 6px 0 0',
        }}
      >
        <p className="font-bold text-gray-800 leading-snug truncate" style={{ fontSize: 15 }}>
          {community.ent_group_name}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {community.real_count ?? 0}r / {community.projected_count ?? 0}p / {community.total_count ?? 0}t
          {devs.length > 0 && ` · ${devs.length} dev${devs.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Dev cards — content height */}
      <div className="flex flex-col gap-1 p-2">
        {devs.length > 0 ? (
          devs.map((dev) => (
            <DevCard key={dev.dev_id} dev={dev} isPending={pendingDevId === dev.dev_id} />
          ))
        ) : (
          <p className="text-[11px] text-gray-300 italic text-center mt-2">
            {isOver ? 'Drop here' : 'no developments'}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NewCommunityDropZone — droppable zone always shown at end of pill list
// ---------------------------------------------------------------------------
function NewCommunityDropZone({ pendingNewComm, newCommName, newCommCreating, newCommError, onNameChange, onCreate, onCancel }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'new-community',
    data: { type: 'new-community' },
    disabled: !!pendingNewComm,
  })

  if (pendingNewComm) {
    return (
      <div
        style={{
          width: '100%',
          border: '2px dashed #3b82f6',
          borderRadius: 12,
          background: '#eff6ff',
          padding: '8px 10px',
        }}
      >
        <p className="text-xs font-semibold text-blue-700 mb-1 truncate">
          New community for {pendingNewComm.dev.dev_name}
        </p>
        <input
          autoFocus
          type="text"
          value={newCommName}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCreate()
            if (e.key === 'Escape') onCancel()
          }}
          disabled={newCommCreating}
          className="w-full text-xs border border-blue-300 rounded px-2 py-1 mb-1 focus:outline-none focus:border-blue-500"
        />
        {newCommError && (
          <p className="text-[11px] text-red-600 mb-1">{newCommError}</p>
        )}
        <div className="flex gap-1">
          <button
            onClick={onCreate}
            disabled={!newCommName.trim() || newCommCreating}
            className="flex-1 text-xs bg-blue-500 text-white rounded px-2 py-1 hover:bg-blue-600 disabled:opacity-40"
          >
            {newCommCreating ? 'Creating…' : 'Create'}
          </button>
          <button
            onClick={onCancel}
            disabled={newCommCreating}
            className="text-xs text-gray-500 rounded px-2 py-1 hover:bg-blue-100"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        width: '100%',
        border: `2px dashed ${isOver ? '#3b82f6' : '#d1d5db'}`,
        borderRadius: 12,
        background: isOver ? '#eff6ff' : 'transparent',
        padding: '8px 10px',
        minHeight: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 0.1s, background 0.1s',
      }}
    >
      <p className={`text-xs italic ${isOver ? 'text-blue-600' : 'text-gray-400'}`}>
        Drop to create community
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommunityDevelopmentsView — main export
// ---------------------------------------------------------------------------
export default function CommunityDevelopmentsView({ entGroupId }) {
  const [communities, setCommunities] = useState([])
  const [developments, setDevelopments] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [activeDev, setActiveDev] = useState(null)
  const [pendingDevId, setPendingDevId] = useState(null)
  const [sliderValue, setSliderValue] = useState(0)
  const [pendingNewComm, setPendingNewComm] = useState(null) // { dev, proposedName }
  const [newCommName, setNewCommName] = useState('')
  const [newCommCreating, setNewCommCreating] = useState(false)
  const [newCommError, setNewCommError] = useState('')
  const [toasts, setToasts] = useState([])
  const toastCounter = useRef(0)

  const pillContainerRef = useRef(null)
  const pillRefs = useRef({})
  const autoScrollTimerRef = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // -----------------------------------------------------------------------
  // Data fetch
  // -----------------------------------------------------------------------
  useEffect(() => {
    Promise.all([
      fetch('/api/entitlement-groups').then((r) => r.json()),
      fetch('/api/developments').then((r) => r.json()),
    ])
      .then(([comms, devs]) => {
        setCommunities(comms)
        setDevelopments(devs)
        setLoading(false)
      })
      .catch((err) => {
        setFetchError(err.message)
        setLoading(false)
      })
  }, [])

  // -----------------------------------------------------------------------
  // Scroll to selected community after data loads or selection changes
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (loading || entGroupId == null) return
    // Wait one frame so pill offsetLeft values are stable after render
    requestAnimationFrame(() => {
      const el = pillRefs.current[entGroupId]
      const container = pillContainerRef.current
      if (!el || !container) return
      const scrollTarget = Math.max(0, el.offsetLeft - 20)
      container.scrollLeft = scrollTarget
      const maxScroll = container.scrollWidth - container.clientWidth
      if (maxScroll > 0) {
        setSliderValue(Math.round((scrollTarget / maxScroll) * 25))
      }
    })
  }, [loading, entGroupId])

  // -----------------------------------------------------------------------
  // Auto-scroll pill container when dragging near left/right edges (≤ 80px)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!activeDev) {
      clearInterval(autoScrollTimerRef.current)
      autoScrollTimerRef.current = null
      return
    }

    function onPointerMove(e) {
      const container = pillContainerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX
      const threshold = 80

      clearInterval(autoScrollTimerRef.current)
      autoScrollTimerRef.current = null

      if (x > rect.left && x < rect.left + threshold) {
        const speed = Math.max(2, Math.round(8 * (1 - (x - rect.left) / threshold)))
        autoScrollTimerRef.current = setInterval(() => {
          container.scrollLeft = Math.max(0, container.scrollLeft - speed)
          syncSlider()
        }, 16)
      } else if (x > rect.right - threshold && x < rect.right) {
        const speed = Math.max(2, Math.round(8 * (1 - (rect.right - x) / threshold)))
        autoScrollTimerRef.current = setInterval(() => {
          container.scrollLeft = Math.min(
            container.scrollWidth - container.clientWidth,
            container.scrollLeft + speed,
          )
          syncSlider()
        }, 16)
      }
    }

    document.addEventListener('pointermove', onPointerMove)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      clearInterval(autoScrollTimerRef.current)
      autoScrollTimerRef.current = null
    }
  }, [activeDev])

  // -----------------------------------------------------------------------
  // Toast helpers
  // -----------------------------------------------------------------------
  const addToast = useCallback((type, message) => {
    const id = ++toastCounter.current
    setToasts((prev) => [...prev, { id, type, message }])
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // -----------------------------------------------------------------------
  // Alphabet slider ↔ scroll sync
  // -----------------------------------------------------------------------
  function syncSlider() {
    const container = pillContainerRef.current
    if (!container) return
    const maxScroll = container.scrollWidth - container.clientWidth
    if (maxScroll <= 0) return
    setSliderValue(Math.round((container.scrollLeft / maxScroll) * 25))
  }

  function handleSliderChange(e) {
    const val = Number(e.target.value)
    setSliderValue(val)
    const container = pillContainerRef.current
    if (!container) return
    const maxScroll = container.scrollWidth - container.clientWidth
    container.scrollLeft = (val / 25) * maxScroll
  }

  function handleContainerScroll() {
    syncSlider()
  }

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------
  const unassignedDevs = developments.filter((d) => d.community_id === null)

  const devsByComm = {}
  for (const dev of developments) {
    if (dev.community_id !== null) {
      if (!devsByComm[dev.community_id]) devsByComm[dev.community_id] = []
      devsByComm[dev.community_id].push(dev)
    }
  }

  const sortedCommunities = [...communities].sort((a, b) =>
    a.ent_group_name.localeCompare(b.ent_group_name)
  )

  // -----------------------------------------------------------------------
  // Drag handlers
  // -----------------------------------------------------------------------
  function handleDragStart(event) {
    if (event.active.data.current?.type === 'development') {
      setActiveDev(event.active.data.current?.dev ?? null)
    }
  }

  function handleDragCancel() {
    setActiveDev(null)
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    setActiveDev(null)
    if (!over) return

    if (active.data.current?.type !== 'development') return

    const dev = active.data.current?.dev
    const overType = over.data.current?.type

    if (overType === 'new-community') {
      if (!pendingNewComm) {
        setPendingNewComm({ dev })
        setNewCommName(dev.dev_name)
        setNewCommError('')
      }
      return
    }

    let newCommunityId
    if (overType === 'community-target') {
      newCommunityId = over.data.current?.communityId
    } else if (overType === 'unassigned-devs') {
      newCommunityId = null
    } else {
      return
    }

    if (dev.community_id === newCommunityId) return

    setPendingDevId(dev.dev_id)

    // Optimistic local update
    setDevelopments((prev) =>
      prev.map((d) => (d.dev_id === dev.dev_id ? { ...d, community_id: newCommunityId } : d))
    )

    try {
      const res = await fetch(`/api/developments/${dev.dev_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ community_id: newCommunityId }),
      })
      const data = await res.json()

      if (res.ok) {
        // Reload both endpoints so pill totals and dev cards reflect the new state
        const [comms, devs] = await Promise.all([
          fetch('/api/entitlement-groups').then((r) => r.json()),
          fetch('/api/developments').then((r) => r.json()),
        ])
        setCommunities(comms)
        setDevelopments(devs)

        const commName =
          newCommunityId === null
            ? 'Unassigned'
            : (comms.find((c) => c.ent_group_id === newCommunityId)?.ent_group_name ??
               `community ${newCommunityId}`)
        addToast('success', `${dev.dev_name} → ${commName}`)
      } else {
        // Revert optimistic update
        setDevelopments((prev) =>
          prev.map((d) => (d.dev_id === dev.dev_id ? { ...d, community_id: dev.community_id } : d))
        )
        addToast('error', data?.detail ?? 'Update failed')
      }
    } catch (err) {
      setDevelopments((prev) =>
        prev.map((d) => (d.dev_id === dev.dev_id ? { ...d, community_id: dev.community_id } : d))
      )
      addToast('error', `Network error: ${err.message}`)
    } finally {
      setPendingDevId(null)
    }
  }

  // -----------------------------------------------------------------------
  // New-community drop zone handlers
  // -----------------------------------------------------------------------
  function handleCancelNewComm() {
    setPendingNewComm(null)
    setNewCommName('')
    setNewCommError('')
  }

  async function handleCreateCommunity() {
    const name = newCommName.trim()
    if (!name) return
    setNewCommCreating(true)
    setNewCommError('')
    try {
      const res1 = await fetch('/api/entitlement-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_name: name }),
      })
      const comm = await res1.json()
      if (!res1.ok) {
        setNewCommError(comm?.detail ?? 'Failed to create community')
        setNewCommCreating(false)
        return
      }

      const res2 = await fetch(`/api/developments/${pendingNewComm.dev.dev_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ community_id: comm.ent_group_id }),
      })
      if (!res2.ok) {
        const e = await res2.json()
        setNewCommError(e?.detail ?? 'Community created but failed to assign dev')
        setNewCommCreating(false)
        return
      }

      const [comms, devs] = await Promise.all([
        fetch('/api/entitlement-groups').then((r) => r.json()),
        fetch('/api/developments').then((r) => r.json()),
      ])
      setCommunities(comms)
      setDevelopments(devs)
      addToast('success', `${pendingNewComm.dev.dev_name} → ${name} (new)`)
      setPendingNewComm(null)
      setNewCommName('')
      setNewCommError('')
    } catch (err) {
      setNewCommError(`Network error: ${err.message}`)
    } finally {
      setNewCommCreating(false)
    }
  }

  // -----------------------------------------------------------------------
  // Collision detection — filter to community and unassigned-devs droppables
  // -----------------------------------------------------------------------
  function devCustomCollision(args) {
    if (args.active?.data?.current?.type === 'development') {
      const filtered = {
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) =>
            c.data?.current?.type === 'community-target' ||
            c.data?.current?.type === 'unassigned-devs' ||
            c.data?.current?.type === 'new-community',
        ),
      }
      const result = pointerWithin(filtered)
      return result.length > 0 ? result : closestCenter(filtered)
    }
    return closestCenter(args)
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={devCustomCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-1 overflow-hidden">

        {/* Unassigned Developments panel — sticky full height */}
        <div
          style={{ width: 168, flexShrink: 0 }}
          className="h-full flex flex-col border-r border-gray-200"
        >
          <UnassignedDevsPanel devs={unassignedDevs} pendingDevId={pendingDevId} />
        </div>

        {/* Community pill area */}
        <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">

          {/* Alphabet slider — not scrollable, pinned above pills */}
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200">
            <span className="text-xs text-gray-400 font-mono select-none w-3 text-center">A</span>
            <input
              type="range"
              min="0"
              max="25"
              step="1"
              value={sliderValue}
              onChange={handleSliderChange}
              className="flex-1 accent-blue-500"
              aria-label="Pan communities A to Z"
            />
            <span className="text-xs text-gray-400 font-mono select-none w-3 text-center">Z</span>
          </div>

          {/* Pills scroll container — multi-column vertical flow, horizontal scroll */}
          {loading ? (
            <div className="flex items-center justify-center flex-1 text-gray-500 text-sm">
              Loading…
            </div>
          ) : fetchError ? (
            <div className="flex items-center justify-center flex-1 text-red-600 text-sm">
              Failed to load: {fetchError}
            </div>
          ) : (
            <div
              ref={pillContainerRef}
              className="flex-1 overflow-x-auto overflow-y-hidden"
              onScroll={handleContainerScroll}
            >
              <div
                style={{
                  columnWidth: 280,
                  columnFill: 'auto',
                  columnGap: 15,
                  height: '100%',
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 0,
                  paddingRight: 0,
                }}
              >
                <div style={{ breakInside: 'avoid', marginBottom: 15, display: 'inline-block', width: '100%' }}>
                  <NewCommunityDropZone
                    pendingNewComm={pendingNewComm}
                    newCommName={newCommName}
                    newCommCreating={newCommCreating}
                    newCommError={newCommError}
                    onNameChange={setNewCommName}
                    onCreate={handleCreateCommunity}
                    onCancel={handleCancelNewComm}
                  />
                </div>
                {sortedCommunities.map((c) => (
                  <div
                    key={c.ent_group_id}
                    style={{ breakInside: 'avoid', marginBottom: 15, display: 'inline-block', width: '100%' }}
                  >
                    <CommunityPill
                      community={c}
                      devs={devsByComm[c.ent_group_id] ?? []}
                      isSelected={c.ent_group_id === entGroupId}
                      pendingDevId={pendingDevId}
                      innerRef={(el) => {
                        if (el) pillRefs.current[c.ent_group_id] = el
                        else delete pillRefs.current[c.ent_group_id]
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDev && <DevCard dev={activeDev} isOverlay />}
      </DragOverlay>

      {/* Toast stack */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            id={t.id}
            type={t.type}
            message={t.message}
            onDismiss={dismissToast}
          />
        ))}
      </div>
    </DndContext>
  )
}
