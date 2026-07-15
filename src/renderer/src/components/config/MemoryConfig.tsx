import { useState } from 'react'
import { useConfigStore } from '../../stores/configStore'

export function MemoryConfig() {
  const { memoryItems, rulesItems, updateMemory, deleteMemory, addMemory, updateRule, deleteRule, addRule } = useConfigStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<'memory' | 'rule'>('memory')

  const openEdit = (type: 'memory' | 'rule', id: string, text: string) => {
    setEditType(type)
    setEditingId(id)
    setEditText(text)
  }

  const saveEdit = () => {
    if (!editText.trim() || !editingId) return
    if (editType === 'memory') updateMemory(editingId, editText.trim())
    else updateRule(editingId, editText.trim())
    setEditingId(null)
  }

  return (
    <div>
      <div className="text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider mb-2">聊天记忆</div>
      <div className="flex flex-col gap-1.5 mb-6">
        {memoryItems.map(m => (
          <div key={m.id} className="bg-white border border-[#e2e8f0] rounded-md py-3 px-3.5 flex items-center gap-3 hover:border-[#cbd5e1] transition-colors">
            {editingId === m.id && editType === 'memory' ? (
              <>
                <input
                  className="flex-1 px-2 py-1 border border-[#e2e8f0] rounded text-[13px] outline-none focus:border-[#a7f3d0]"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                  autoFocus
                />
                <button onClick={saveEdit} className="text-[11px] text-[#047857] font-medium hover:underline">保存</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-[13px] text-[#0f172a]">{m.text}</span>
                <span className="text-[11px] text-[#94a3b8] flex-shrink-0">{m.time}</span>
                <button onClick={() => openEdit('memory', m.id, m.text)} className="text-[#94a3b8] hover:text-[#047857] hover:bg-[#f0fdf4] p-1 rounded transition-colors bg-transparent border-none cursor-pointer">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 14h2l8-8-2-2-8 8v2z"/><path d="M12 3l2 2"/></svg>
                </button>
                <button onClick={() => deleteMemory(m.id)} className="text-[#94a3b8] hover:text-[#ef4444] hover:bg-[#fef2f2] p-1 rounded transition-colors bg-transparent border-none cursor-pointer">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 4 14 4 12 16 4 16 2 4"/><line x1="6" y1="7" x2="6" y2="12"/><line x1="10" y1="7" x2="10" y2="12"/></svg>
                </button>
              </>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            const text = prompt('输入新的记忆:')
            if (text?.trim()) addMemory(text.trim())
          }}
          className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-[#e2e8f0] rounded-md text-[13px] text-[#64748b] hover:border-[#a7f3d0] hover:text-[#047857] hover:bg-[#f0fdf4] transition-colors cursor-pointer bg-white mt-1"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>
          添加记忆
        </button>
      </div>

      <div className="text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider mb-2 mt-5">Rules</div>
      <div className="flex flex-col gap-1.5">
        {rulesItems.map(r => (
          <div key={r.id} className="bg-white border border-[#e2e8f0] rounded-md py-3 px-3.5 flex items-center gap-3 hover:border-[#cbd5e1] transition-colors">
            {editingId === r.id && editType === 'rule' ? (
              <>
                <input
                  className="flex-1 px-2 py-1 border border-[#e2e8f0] rounded text-[13px] outline-none focus:border-[#a7f3d0]"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                  autoFocus
                />
                <button onClick={saveEdit} className="text-[11px] text-[#047857] font-medium hover:underline">保存</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-[13px] text-[#0f172a]">{r.text}</span>
                <span className="text-[11px] text-[#94a3b8] flex-shrink-0">{r.time}</span>
                <button onClick={() => openEdit('rule', r.id, r.text)} className="text-[#94a3b8] hover:text-[#047857] hover:bg-[#f0fdf4] p-1 rounded transition-colors bg-transparent border-none cursor-pointer">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 14h2l8-8-2-2-8 8v2z"/><path d="M12 3l2 2"/></svg>
                </button>
                <button onClick={() => deleteRule(r.id)} className="text-[#94a3b8] hover:text-[#ef4444] hover:bg-[#fef2f2] p-1 rounded transition-colors bg-transparent border-none cursor-pointer">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 4 14 4 12 16 4 16 2 4"/><line x1="6" y1="7" x2="6" y2="12"/><line x1="10" y1="7" x2="10" y2="12"/></svg>
                </button>
              </>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            const text = prompt('输入新的规则:')
            if (text?.trim()) addRule(text.trim())
          }}
          className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-[#e2e8f0] rounded-md text-[13px] text-[#64748b] hover:border-[#a7f3d0] hover:text-[#047857] hover:bg-[#f0fdf4] transition-colors cursor-pointer bg-white mt-1"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>
          添加规则
        </button>
      </div>
    </div>
  )
}
