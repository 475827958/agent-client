import { useState, useRef, useCallback } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useModeStore } from '../../stores/modeStore'
import { useQueueStore } from '../../stores/queueStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { AppMode } from '../../types'

const MODELS = ['deepseek-v4-pro',]
const WORKSPACES = ['/projects/data-report', '/projects/my-app', '/home/user/documents']

export function ChatInput() {
  const sendMessage = useChatStore((s) => s.sendMessage)
  const isProcessing = useChatStore((s) => s.isProcessing)
  const inputMode = useModeStore((s) => s.inputMode)
  const setInputMode = useModeStore((s) => s.setInputMode)
  const queue = useQueueStore((s) => s.queue)
  const removeFromQueue = useQueueStore((s) => s.removeFromQueue)
  const settings = useSettingsStore((s) => s.settings)
  const saveSettings = useSettingsStore((s) => s.save)

  const [text, setText] = useState('')
  const [wsDropdown, setWsDropdown] = useState(false)
  const [mdDropdown, setMdDropdown] = useState(false)
  const [modeDropdown, setModeDropdown] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    if (!text.trim() || isProcessing) return
    sendMessage(text.trim())
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, isProcessing, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 80) + 'px'
  }

  const closeAllDropdowns = () => {
    setWsDropdown(false)
    setMdDropdown(false)
    setModeDropdown(false)
  }

  const hasMessages = true // Always show input area

  return (
    <div className={`flex-shrink-0 flex flex-col gap-2.5 ${hasMessages ? 'py-4 px-6 border-t border-[#e2e8f0] bg-white' : ''}`}>
      {/* Queue */}
      {queue.length > 0 && (
        <div className="flex flex-col gap-1.5 max-w-[740px] w-full mx-auto">
          {queue.map((qt, i) => (
            <div key={i} className="flex items-center gap-2 px-3.5 py-2 border border-[#e2e8f0] rounded-md text-[13px] bg-white">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-[#fffbeb] text-[#b45309] flex-shrink-0">
                等待中 {i + 1}
              </span>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[#64748b]">
                {qt.length > 60 ? qt.substring(0, 60) + '...' : qt}
              </span>
              <button
                onClick={() => removeFromQueue(i)}
                className="text-[#94a3b8] hover:text-[#ef4444] hover:bg-[#fef2f2] p-0.5 rounded transition-colors bg-transparent border-none cursor-pointer text-sm"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input box */}
      <div className={`flex items-center gap-2.5 border border-[#e2e8f0] rounded-[10px] py-2.5 px-4 transition-all bg-white focus-within:border-[#a7f3d0] focus-within:shadow-[0_0_0_3px_rgba(167,243,208,0.3)] ${hasMessages ? 'max-w-[740px] w-full mx-auto' : 'max-w-[768px] w-full mx-auto shadow-sm'}`}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); autoResize(e.target) }}
          onKeyDown={handleKeyDown}
          placeholder="输入任务，@引用文件， /调用技能与指令"
          rows={1}
          className="flex-1 border-none bg-transparent resize-none outline-none text-sm text-[#0f172a] leading-relaxed min-h-[24px] max-h-[80px] overflow-hidden placeholder:text-[#94a3b8]"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isProcessing}
          className="bg-transparent border-none cursor-pointer p-1 flex items-center text-[#64748b] disabled:opacity-40 flex-shrink-0"
          style={{ opacity: text.trim() ? 1 : 0.4, pointerEvents: text.trim() ? 'auto' : 'none' }}
        >
          {isProcessing ? (
            <div className="w-[22px] h-[22px] border-2 border-[#94a3b8] border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
            </svg>
          )}
        </button>
      </div>

      {/* Toolbar */}
      <div className={`flex items-center gap-2 ${hasMessages ? 'max-w-[740px] w-full mx-auto' : 'max-w-[768px] w-full mx-auto'}`}>
        {/* Workspace selector */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setWsDropdown(!wsDropdown); setMdDropdown(false); setModeDropdown(false) }}
            className="flex items-center gap-1.5 py-[5px] px-2.5 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 5h3l1.5-2h4L12 5h2a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z"/></svg>
            <span className="text-[11px] text-[#94a3b8]">工作空间</span>
            <span className="font-medium text-[#64748b]">{settings.workspacePath}</span>
            <svg className="w-4 h-4 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 7l3 3 3-3"/></svg>
          </button>
          {wsDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[220px] p-1 z-[100]">
              {WORKSPACES.map(ws => (
                <div
                  key={ws}
                  onClick={() => { saveSettings({ workspacePath: ws }); closeAllDropdowns() }}
                  className={`px-3 py-2 rounded-md text-[13px] cursor-pointer flex items-center gap-2 text-[#0f172a] hover:bg-[#f1f5f9] transition-colors ${settings.workspacePath === ws ? 'bg-[#f0fdf4] text-[#047857] font-medium' : ''}`}
                >
                  {settings.workspacePath === ws && <span className="ml-auto text-[#a7f3d0] font-semibold">✓</span>}
                  {ws}
                </div>
              ))}
              <div className="h-px bg-[#e2e8f0] mx-2 my-1" />
              <div
                onClick={() => { closeAllDropdowns() }}
                className="px-3 py-2 rounded-md text-[13px] cursor-pointer text-[#0f172a] hover:bg-[#f1f5f9] transition-colors"
              >
                浏览选择目录...
              </div>
            </div>
          )}
        </div>

        {/* Model selector */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMdDropdown(!mdDropdown); setWsDropdown(false); setModeDropdown(false) }}
            className="flex items-center gap-1.5 py-[5px] px-2.5 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="3"/><path d="M13.5 8a5.5 5.5 0 00-11 0"/></svg>
            <span className="font-medium text-[#64748b]">{settings.model}</span>
            <svg className="w-4 h-4 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 7l3 3 3-3"/></svg>
          </button>
          {mdDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[200px] p-1 z-[100]">
              {MODELS.map(m => (
                <div
                  key={m}
                  onClick={() => { saveSettings({ model: m }); closeAllDropdowns() }}
                  className={`px-3 py-2 rounded-md text-[13px] cursor-pointer flex items-center gap-2 text-[#0f172a] hover:bg-[#f1f5f9] transition-colors ${settings.model === m ? 'bg-[#f0fdf4] text-[#047857] font-medium' : ''}`}
                >
                  {settings.model === m && <span className="ml-auto text-[#a7f3d0] font-semibold">✓</span>}
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input Mode picker */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setModeDropdown(!modeDropdown); setWsDropdown(false); setMdDropdown(false) }}
            className="flex items-center gap-1 py-[5px] px-2.5 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <span className="font-medium">{inputMode === 'build' ? 'Build' : inputMode === 'plan' ? 'Plan' : 'Ask'}</span>
            <svg className="w-4 h-4 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 7l3 3 3-3"/></svg>
          </button>
          {modeDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[120px] p-1 z-[100]">
              {(['build', 'plan', 'ask'] as AppMode[]).map(m => (
                <div
                  key={m}
                  onClick={() => { setInputMode(m); closeAllDropdowns() }}
                  className={`px-3 py-2 rounded-md text-[13px] cursor-pointer flex items-center gap-2 text-[#0f172a] hover:bg-[#f1f5f9] transition-colors ${inputMode === m ? 'bg-[#f0fdf4] text-[#047857] font-medium' : ''}`}
                >
                  {inputMode === m && <span className="ml-auto text-[#a7f3d0] font-semibold">✓</span>}
                  {m === 'build' ? 'Build' : m === 'plan' ? 'Plan' : 'Ask'}
                </div>
              ))}
            </div>
          )}
        </div>

        <span className="ml-auto text-[11px] text-[#94a3b8]">
          {isProcessing ? 'AI 正在处理中...' : 'Enter 发送 · Shift+Enter 换行'}
        </span>
      </div>
    </div>
  )
}
