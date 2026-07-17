import { useState, useRef, useCallback, useEffect } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useModeStore } from '../../stores/modeStore'
import { useQueueStore } from '../../stores/queueStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { AppMode } from '../../types'

const MODELS = ['deepseek-v4-pro']
const WORKSPACES = ['/projects/data-report', '/projects/my-app', '/home/user/documents']

interface SlashCommand {
  command: string
  label: string
  description: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/help', label: '帮助', description: '获取使用帮助与指令列表' },
  { command: '/clear', label: '清空对话', description: '清空当前会话的所有消息' },
  { command: '/file', label: '引用文件', description: '选择并引用项目中的文件内容' },
  { command: '/search', label: '搜索代码库', description: '在代码库中搜索关键词或符号' },
  { command: '/explain', label: '解释代码', description: '解释选中代码段的逻辑与用途' },
  { command: '/fix', label: '修复问题', description: '查找并修复代码中的错误' },
  { command: '/refactor', label: '重构代码', description: '优化代码结构与可读性' },
  { command: '/test', label: '生成测试', description: '为选中代码生成单元测试' },
  { command: '/doc', label: '生成文档', description: '为函数或类生成文档注释' },
  { command: '/optimize', label: '性能优化', description: '分析并优化代码性能瓶颈' },
]

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
  const [showCommands, setShowCommands] = useState(false)
  const [commandFilter, setCommandFilter] = useState('')
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cmdMenuRef = useRef<HTMLDivElement>(null)

  // Detect slash command trigger
  useEffect(() => {
    const cursorPos = textareaRef.current?.selectionStart ?? 0
    const textBeforeCursor = text.substring(0, cursorPos)
    const lastNewline = textBeforeCursor.lastIndexOf('\n')
    const currentLine = textBeforeCursor.substring(lastNewline + 1)

    if (currentLine.startsWith('/') && !currentLine.includes(' ')) {
      setShowCommands(true)
      setCommandFilter(currentLine)
      setSelectedCmdIdx(0)
    } else {
      setShowCommands(false)
    }
  }, [text])

  const filteredCommands = SLASH_COMMANDS.filter(
    (c) => c.command.startsWith(commandFilter) || c.label.includes(commandFilter.replace('/', ''))
  )

  const insertCommand = useCallback((cmd: SlashCommand) => {
    const cursorPos = textareaRef.current?.selectionStart ?? 0
    const textBeforeCursor = text.substring(0, cursorPos)
    const textAfterCursor = text.substring(cursorPos)
    const lastNewline = textBeforeCursor.lastIndexOf('\n')
    const lineStart = textBeforeCursor.substring(0, lastNewline + 1)
    const newText = lineStart + cmd.command + ' ' + textAfterCursor
    setText(newText)
    setShowCommands(false)
    textareaRef.current?.focus()
  }, [text])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showCommands) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedCmdIdx((prev) => Math.min(prev + 1, filteredCommands.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedCmdIdx((prev) => Math.max(prev - 1, 0))
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          if (filteredCommands[selectedCmdIdx]) {
            insertCommand(filteredCommands[selectedCmdIdx])
          }
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowCommands(false)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [showCommands, filteredCommands, selectedCmdIdx, insertCommand]
  )

  const handleSend = useCallback(() => {
    if (!text.trim() || isProcessing) return
    sendMessage(text.trim())
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, isProcessing, sendMessage])

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const closeAllDropdowns = () => {
    setWsDropdown(false)
    setMdDropdown(false)
    setModeDropdown(false)
  }

  return (
    <div className="flex-shrink-0 flex flex-col gap-2.5 px-6 pb-4 pt-3">
      {/* Queue */}
      {queue.length > 0 && (
        <div className="flex flex-col gap-1.5 max-w-[740px] w-full mx-auto">
          {queue.map((qt, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3.5 py-2 border border-[#e2e8f0] rounded-md text-[13px] bg-white"
            >
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

      {/* Slash command popup */}
      {showCommands && filteredCommands.length > 0 && (
        <div
          ref={cmdMenuRef}
          className="max-w-[740px] w-full mx-auto bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg overflow-hidden animate-[msgIn_0.15s_ease-out]"
        >
          {filteredCommands.map((cmd, idx) => (
            <button
              key={cmd.command}
              onClick={() => insertCommand(cmd)}
              onMouseEnter={() => setSelectedCmdIdx(idx)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-none bg-transparent cursor-pointer transition-colors ${
                idx === selectedCmdIdx ? 'bg-[#f0fdf4]' : 'hover:bg-[#f8fafc]'
              } ${idx !== 0 ? 'border-t border-[#f1f5f9]' : ''}`}
            >
              <span className="text-[13px] font-semibold text-[#047857] w-[70px] flex-shrink-0">
                {cmd.command}
              </span>
              <span className="text-[13px] text-[#0f172a] font-medium">{cmd.label}</span>
              <span className="text-[12px] text-[#94a3b8] ml-auto hidden sm:block">
                {cmd.description}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Input area — rounded pill container */}
      <div className="max-w-[740px] w-full mx-auto flex items-end gap-2 border rounded-[24px] py-2.5 px-4 transition-colors focus-within:border-[#a7f3d0]"
        style={{ borderColor: 'rgba(0,0,0,.1)' }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            autoResize(e.target)
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入任务，@引用文件， /调用技能与指令"
          rows={2}
          className="flex-1 border-none bg-transparent resize-none outline-none text-[15px] text-[#0f172a] leading-relaxed min-h-[44px] max-h-[200px] overflow-y-auto placeholder:text-[#94a3b8] py-0"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isProcessing}
          className="flex-shrink-0 w-[32px] h-[32px] rounded-full flex items-center justify-center border-none cursor-pointer transition-all mb-0.5"
          style={{
            backgroundColor: text.trim() ? '#a7f3d0' : '#f1f5f9',
            color: text.trim() ? '#047857' : '#94a3b8',
            opacity: 1,
          }}
        >
          {isProcessing ? (
            <div className="w-[16px] h-[16px] border-[2px] border-[#047857] border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          )}
        </button>
      </div>

      {/* Toolbar */}
      <div className="max-w-[740px] w-full mx-auto flex items-center gap-2">
        {/* Workspace selector */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setWsDropdown(!wsDropdown)
              setMdDropdown(false)
              setModeDropdown(false)
            }}
            className="flex items-center gap-1 py-[4px] px-2 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M2 5h3l1.5-2h4L12 5h2a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z" />
            </svg>
            <span className="font-medium text-[#64748b] text-[11px]">{settings.workspacePath}</span>
            <svg
              className="w-3.5 h-3.5 text-[#94a3b8]"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 7l3 3 3-3" />
            </svg>
          </button>
          {wsDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[220px] p-1 z-[100]">
              {WORKSPACES.map((ws) => (
                <div
                  key={ws}
                  onClick={() => {
                    saveSettings({ workspacePath: ws })
                    closeAllDropdowns()
                  }}
                  className={`px-3 py-2 rounded-md text-[13px] cursor-pointer flex items-center gap-2 text-[#0f172a] hover:bg-[#f1f5f9] transition-colors ${
                    settings.workspacePath === ws
                      ? 'bg-[#f0fdf4] text-[#047857] font-medium'
                      : ''
                  }`}
                >
                  {settings.workspacePath === ws && (
                    <span className="ml-auto text-[#a7f3d0] font-semibold">✓</span>
                  )}
                  {ws}
                </div>
              ))}
              <div className="h-px bg-[#e2e8f0] mx-2 my-1" />
              <div
                onClick={() => closeAllDropdowns()}
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
            onClick={(e) => {
              e.stopPropagation()
              setMdDropdown(!mdDropdown)
              setWsDropdown(false)
              setModeDropdown(false)
            }}
            className="flex items-center gap-1 py-[4px] px-2 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="3" />
              <path d="M13.5 8a5.5 5.5 0 00-11 0" />
            </svg>
            <span className="font-medium text-[#64748b] text-[11px]">{settings.model}</span>
            <svg
              className="w-3.5 h-3.5 text-[#94a3b8]"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 7l3 3 3-3" />
            </svg>
          </button>
          {mdDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[200px] p-1 z-[100]">
              {MODELS.map((m) => (
                <div
                  key={m}
                  onClick={() => {
                    saveSettings({ model: m })
                    closeAllDropdowns()
                  }}
                  className={`px-3 py-2 rounded-md text-[13px] cursor-pointer flex items-center gap-2 text-[#0f172a] hover:bg-[#f1f5f9] transition-colors ${
                    settings.model === m
                      ? 'bg-[#f0fdf4] text-[#047857] font-medium'
                      : ''
                  }`}
                >
                  {settings.model === m && (
                    <span className="ml-auto text-[#a7f3d0] font-semibold">✓</span>
                  )}
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input Mode picker */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setModeDropdown(!modeDropdown)
              setWsDropdown(false)
              setMdDropdown(false)
            }}
            className="flex items-center gap-1 py-[4px] px-2 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <span className="font-medium text-[11px]">
              {inputMode === 'build' ? 'Build' : inputMode === 'plan' ? 'Plan' : 'Ask'}
            </span>
            <svg
              className="w-3.5 h-3.5 text-[#94a3b8]"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 7l3 3 3-3" />
            </svg>
          </button>
          {modeDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[120px] p-1 z-[100]">
              {(['build', 'plan', 'ask'] as AppMode[]).map((m) => (
                <div
                  key={m}
                  onClick={() => {
                    setInputMode(m)
                    closeAllDropdowns()
                  }}
                  className={`px-3 py-2 rounded-md text-[13px] cursor-pointer flex items-center gap-2 text-[#0f172a] hover:bg-[#f1f5f9] transition-colors ${
                    inputMode === m
                      ? 'bg-[#f0fdf4] text-[#047857] font-medium'
                      : ''
                  }`}
                >
                  {inputMode === m && (
                    <span className="ml-auto text-[#a7f3d0] font-semibold">✓</span>
                  )}
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
