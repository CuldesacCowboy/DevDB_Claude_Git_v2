import { useState } from 'react'

export default function TdaPageHeader({
  entGroupName,
  agreements,
  selectedTdaId,
  setSelectedTdaId,
  mutationStatus,
  createTda,
}) {
  const [showNewTdaForm, setShowNewTdaForm] = useState(false)
  const [newTdaName, setNewTdaName] = useState('')
  const [newTdaError, setNewTdaError] = useState('')

  const isSaving = mutationStatus.status === 'saving'

  async function handleCreateTda() {
    setNewTdaError('')
    const result = await createTda(newTdaName)
    if (!result.ok) { setNewTdaError(result.error); return }
    setNewTdaName('')
    setShowNewTdaForm(false)
  }

  return (
    <div style={{
      background: '#fff', borderBottom: '1px solid #e5e7eb',
      padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexShrink: 0,
    }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>
          Takedown Agreements
        </h1>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
          {entGroupName}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Mutation status indicator */}
        {isSaving && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>Saving…</span>
        )}
        {mutationStatus.status === 'error' && (
          <span style={{ fontSize: 12, color: '#dc2626' }}>{mutationStatus.error}</span>
        )}

        {agreements.length > 0 && (
          <select
            value={selectedTdaId || ''}
            onChange={e => setSelectedTdaId(Number(e.target.value))}
            style={{
              fontSize: 14, padding: '5px 10px', borderRadius: 6,
              border: '1px solid #d1d5db', background: '#fff', color: '#374151',
            }}
          >
            {agreements.map(a => (
              <option key={a.tda_id} value={a.tda_id}>{a.tda_name}</option>
            ))}
          </select>
        )}
        {showNewTdaForm ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              autoFocus
              type="text"
              placeholder="Agreement name"
              value={newTdaName}
              onChange={e => { setNewTdaName(e.target.value); setNewTdaError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateTda()
                if (e.key === 'Escape') { setShowNewTdaForm(false); setNewTdaName(''); setNewTdaError('') }
              }}
              style={{
                fontSize: 14, padding: '5px 10px', borderRadius: 6,
                border: `1px solid ${newTdaError ? '#ef4444' : '#d1d5db'}`,
                outline: 'none', width: 200, color: '#374151',
              }}
            />
            <button
              onClick={handleCreateTda}
              disabled={isSaving}
              style={{
                fontSize: 13, padding: '5px 12px', borderRadius: 6,
                border: 'none', background: '#2563eb', color: '#fff',
                cursor: isSaving ? 'default' : 'pointer', opacity: isSaving ? 0.6 : 1,
              }}
            >
              {isSaving ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => { setShowNewTdaForm(false); setNewTdaName(''); setNewTdaError('') }}
              style={{
                fontSize: 13, padding: '5px 10px', borderRadius: 6,
                border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {newTdaError && (
              <span style={{ fontSize: 12, color: '#ef4444' }}>{newTdaError}</span>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowNewTdaForm(true)}
            style={{
              fontSize: 13, padding: '5px 14px', borderRadius: 6,
              border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
              cursor: 'pointer',
            }}
          >
            + New agreement
          </button>
        )}
      </div>
    </div>
  )
}
