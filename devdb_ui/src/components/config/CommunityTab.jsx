import { useState, useRef, useEffect } from 'react'
import { EditableCell, cellHighlight } from '../EditableCell'
import { MonthCell, TableShell, BAND } from './configShared'

// Column metadata: index → { editable, kind, autoOpen }
const COMM_COLS = [
  { editable: false },                                     // 0 community name
  { editable: true, kind: 'edit',     autoOpen: false },  // 1 date_paper (date — don't auto-open)
  { editable: true, kind: 'edit',     autoOpen: false },  // 2 date_ent   (date — don't auto-open)
  { editable: true, kind: 'checkbox', autoOpen: false },  // 3 auto_schedule
  { editable: true, kind: 'month',    autoOpen: false },  // 4 delivery_months
  { editable: true, kind: 'edit',     autoOpen: true  },  // 5 del/year (number)
]

export function CommunityTab({ rows, showTest, onPatchComm, globalMonths, onSaveGlobal }) {
  const filtered = rows.filter(r => showTest ? r.is_test : !r.is_test)
  const [activeCell,      setActiveCell]      = useState(null)
  const [activateSignal,  setActivateSignal]  = useState(0)
  const containerRef = useRef()

  const maxRow = filtered.length - 1

  useEffect(() => {
    if (!activeCell) return
    const col = COMM_COLS[activeCell.c]
    if (col?.autoOpen) setActivateSignal(s => s + 1)
  }, [activeCell])

  function handleKeyDown(e) {
    const NAV = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']
    if (!NAV.includes(e.key)) return
    const ae = document.activeElement
    if (ae && ae.type === 'date') return
    if (ae && ae.type === 'number') return
    e.preventDefault()
    e.stopPropagation()
    if (ae && ae !== containerRef.current) ae.blur()
    setActiveCell(prev => {
      const r = prev?.r ?? 0
      const c = prev?.c ?? 1
      if (e.key === 'ArrowUp')    return { r: Math.max(0, r - 1), c }
      if (e.key === 'ArrowDown')  return { r: Math.min(maxRow, r + 1), c }
      if (e.key === 'ArrowLeft')  return { r, c: Math.max(0, c - 1) }
      if (e.key === 'ArrowRight') return { r, c: Math.min(COMM_COLS.length - 1, c + 1) }
    })
  }

  function onDone() { containerRef.current?.focus() }

  const ac = (r, c) => activeCell?.r === r && activeCell?.c === c

  const thB = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap',
    borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 2,
    textAlign: 'left',
  }
  const thR = { ...thB, textAlign: 'right' }
  const thG = { ...thR, borderLeft: '2px solid #e0e0e0' }

  return (
    <div ref={containerRef} tabIndex={0} onKeyDownCapture={handleKeyDown}
         onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setActiveCell(null) }}
         style={{ outline: 'none' }}>
      <TableShell>
        <thead>
          <tr>
            <th style={{ ...thB, width: 200, position: 'sticky', top: 0, left: 0, zIndex: 5,
                         boxShadow: '4px 0 8px -2px rgba(0,0,0,0.08)' }}>
              Community
            </th>
            <th style={{ ...thG, width: 100 }}>Ledger Start</th>
            <th style={{ ...thR, width: 110 }}>Bulk Ent. Date</th>
            <th style={{ ...thG, width: 90, textAlign: 'center' }}>Auto Schedule</th>
            <th style={{ ...thG, width: 240 }}>Delivery Months</th>
            <th style={{ ...thR, width: 72 }}>Del / Year</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              No communities.
            </td></tr>
          )}
          {filtered.map((row, i) => {
            const bg = BAND[i % 2]
            const td  = (c, extra = {}) => ({
              padding: '6px 8px', borderTop: '1px solid #f0f0f0', verticalAlign: 'middle',
              ...cellHighlight(ac(i, c), COMM_COLS[c].editable),
              background: ac(i, c) ? (COMM_COLS[c].editable ? '#eff6ff' : '#f1f5f9') : bg,
              ...extra,
            })
            const tdG = (c, extra = {}) => ({ ...td(c, extra), borderLeft: '2px solid #ebebeb' })

            return (
              <tr key={row.ent_group_id} onClick={() => setActiveCell({ r: i, c: activeCell?.c ?? 1 })}>
                <td style={{ ...td(0), position: 'sticky', left: 0, zIndex: 1,
                             boxShadow: '4px 0 8px -2px rgba(0,0,0,0.06)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                    {row.ent_group_name}
                  </span>
                </td>

                <td style={tdG(1, { textAlign: 'right' })}>
                  <EditableCell value={row.date_paper} type="date" width={90}
                    triggerActivate={ac(i, 1) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchComm(row.ent_group_id, 'ledger', { date_paper: v, date_ent: row.date_ent })} />
                </td>

                <td style={td(2, { textAlign: 'right' })}>
                  <EditableCell value={row.date_ent} type="date" width={100}
                    triggerActivate={ac(i, 2) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchComm(row.ent_group_id, 'ledger', { date_paper: row.date_paper, date_ent: v })} />
                </td>

                <td style={tdG(3, { textAlign: 'center' })}>
                  <input type="checkbox"
                    checked={row.auto_schedule_enabled ?? false}
                    onChange={e => onPatchComm(row.ent_group_id, 'delivery', { auto_schedule_enabled: e.target.checked })}
                    style={{ cursor: 'pointer', width: 14, height: 14 }}
                  />
                </td>

                <td style={tdG(4, { padding: '5px 8px' })}>
                  <MonthCell months={row.delivery_months}
                    globalMonths={globalMonths}
                    onSave={v => onPatchComm(row.ent_group_id, 'delivery', { delivery_months: v })}
                    onSaveGlobal={onSaveGlobal} />
                </td>

                <td style={td(5, { textAlign: 'right' })}>
                  <EditableCell value={row.max_deliveries_per_year} width={60}
                    triggerActivate={ac(i, 5) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchComm(row.ent_group_id, 'delivery', { max_deliveries_per_year: v })} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </TableShell>
    </div>
  )
}
