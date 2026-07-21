import { useState, useRef, useCallback, useEffect } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useModeStore } from '../../stores/modeStore'
import { useQueueStore } from '../../stores/queueStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ipcClient } from '../../services/ipcClient'
import type { AppMode } from '../../types'

const MODELS = ['deepseek-v4-pro']

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

// ===== File helpers =====
function basename(p: string): string {
  return p.replace(/^.*[/\\]/, '')
}

function fileExt(p: string): string {
  const dot = p.lastIndexOf('.')
  return dot >= 0 ? p.slice(dot + 1).toLowerCase() : ''
}

function fileColor(p: string): string {
  const ext = fileExt(p)
  const colors: Record<string, string> = {
    ts: '#3178c6', tsx: '#3178c6', js: '#f0db4f', jsx: '#61dafb',
    json: '#f0db4f', css: '#2965f1', scss: '#c6538c', less: '#1d365d',
    html: '#e44d26', htm: '#e44d26', svg: '#ffb13b', md: '#083fa1',
    markdown: '#083fa1', py: '#3572A5', rb: '#701516', go: '#00ADD8',
    rs: '#dea584', java: '#b07219', cpp: '#f34b7d', c: '#555555', h: '#555555',
    sh: '#89e051', bash: '#89e051', yaml: '#cb171e', yml: '#cb171e',
    toml: '#9c4221', xml: '#0060ac', sql: '#e38c00', graphql: '#e10098',
    proto: '#fc4444', vue: '#41b883', svelte: '#ff3e00', prisma: '#2d3748',
    env: '#f0db4f', gitignore: '#f05133', dockerfile: '#2496ed', lock: '#94a3b8',
  }
  return colors[ext] || '#94a3b8'
}

function createFileChipDOM(filePath: string, onRemove: (el: HTMLElement) => void): HTMLElement {
  const color = fileColor(filePath)
  const span = document.createElement('span')
  span.setAttribute('data-file', filePath)
  span.setAttribute('contenteditable', 'false')
  span.style.cssText = `display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:4px;font-size:13px;font-weight:500;border:1px solid ${color}40;background:${color}18;color:${color};cursor:default;vertical-align:middle;margin:0 2px;user-select:none;`
  span.innerHTML = `<span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${basename(filePath)}</span>`
    + `<button style="margin-left:1px;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;opacity:0.4;background:none;border:none;cursor:pointer;font-size:12px;line-height:1;padding:0;color:inherit;flex-shrink:0" tabindex="-1">&times;</button>`
  const btn = span.lastElementChild as HTMLElement
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onRemove(span)
  })
  return span
}

// Collect text and file paths from contenteditable DOM
function readEditor(ed: HTMLElement): { text: string; files: string[] } {
  let text = ''
  const files: string[] = []
  function walk(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.textContent || ''
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement
      if (el.hasAttribute('data-file')) {
        files.push(el.getAttribute('data-file') || '')
      } else if (el.tagName === 'BR') {
        text += '\n'
      } else {
        for (const c of Array.from(el.childNodes)) walk(c)
      }
    }
  }
  for (const c of Array.from(ed.childNodes)) {
    if ((c as HTMLElement).tagName === 'DIV') {
      if (text) text += '\n'
      walk(c)
      text += '\n'
    } else {
      walk(c)
    }
  }
  return { text, files }
}

// Find @ trigger position in plain text before cursor, skipping file chips (same as findPos)
function getAtTrigger(ed: HTMLElement): { pos: number; filter: string } | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  let textBefore = ''
  let stopped = false
  function walk(node: Node) {
    if (stopped) return
    if (node === range.endContainer) {
      if (node.nodeType === Node.TEXT_NODE)
        textBefore += (node.textContent || '').slice(0, range.endOffset)
      stopped = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      textBefore += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.hasAttribute('data-file')) return
      if (el.tagName === 'BR') textBefore += '\n'
      else for (const c of Array.from(node.childNodes)) walk(c)
    }
  }
  for (const c of Array.from(ed.childNodes)) {
    if (stopped) break
    walk(c)
  }
  const lastAt = textBefore.lastIndexOf('@')
  if (lastAt < 0) return null
  const beforeAt = lastAt > 0 ? textBefore[lastAt - 1] : '\0'
  if (beforeAt !== ' ' && beforeAt !== '\n' && beforeAt !== '\0') return null
  const afterAt = textBefore.slice(lastAt + 1)
  if (afterAt.includes(' ') || afterAt.includes('\n')) return null
  return { pos: lastAt, filter: afterAt }
}

export function ChatInput() {
  const sendMessage = useChatStore((s) => s.sendMessage)
  const isProcessing = useChatStore((s) => s.isProcessing)
  const inputMode = useModeStore((s) => s.inputMode)
  const setInputMode = useModeStore((s) => s.setInputMode)
  const queue = useQueueStore((s) => s.queue)
  const removeFromQueue = useQueueStore((s) => s.removeFromQueue)
  const settings = useSettingsStore((s) => s.settings)
  const saveSettings = useSettingsStore((s) => s.save)

  const [wsDropdown, setWsDropdown] = useState(false)
  const [mdDropdown, setMdDropdown] = useState(false)
  const [modeDropdown, setModeDropdown] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  const [commandFilter, setCommandFilter] = useState('')
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0)
  const editableRef = useRef<HTMLDivElement>(null)
  const cmdMenuRef = useRef<HTMLDivElement>(null)

  // @ file picker state
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)
  const [filesLoading, setFilesLoading] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const atPosRef = useRef(-1)
  const insertingRef = useRef(false) // guard against selectionchange firing during insertFileRef

  // Is the editor empty (no text and no chips)?
  const isEmptyRef = useRef(true)

  // Detect @ mention in contenteditable
  useEffect(() => {
    const ed = editableRef.current
    if (!ed) return

    const handleSelectionChange = () => {
      if (!ed.matches(':focus-within')) return
      if (insertingRef.current) return // don't re-evaluate during chip insertion
      const trigger = getAtTrigger(ed)
      if (trigger && settings.workspacePath) {
        setShowFilePicker(true)
        setFileFilter(trigger.filter)
        setSelectedFileIdx(0)
        atPosRef.current = trigger.pos
        if (workspaceFiles.length === 0 && !filesLoading) {
          setFilesLoading(true)
          ipcClient.file.glob('**/*').then((files) => {
            setWorkspaceFiles(files.sort())
            setFilesLoading(false)
          }).catch(() => setFilesLoading(false))
        }
      } else {
        setShowFilePicker(false)
        atPosRef.current = -1
      }

      // Also check for slash commands
      const sel = window.getSelection()
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).cloneRange()
        r.setStart(ed, 0)
        const txt = r.toString()
        const lastNl = txt.lastIndexOf('\n')
        const line = txt.slice(lastNl + 1)
        if (line.startsWith('/') && !line.includes(' ')) {
          setShowCommands(true)
          setCommandFilter(line)
          setSelectedCmdIdx(0)
        } else {
          setShowCommands(false)
        }
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [settings.workspacePath, workspaceFiles.length, filesLoading])

  // Re-fetch files when workspace changes
  useEffect(() => {
    setWorkspaceFiles([])
  }, [settings.workspacePath])

  // Track empty state for placeholder
  const updateEmptyState = useCallback(() => {
    const ed = editableRef.current
    if (!ed) return
    const { text, files } = readEditor(ed)
    isEmptyRef.current = text.trim() === '' && files.length === 0
    // Toggle placeholder class
    if (isEmptyRef.current) {
      ed.classList.add('is-empty')
    } else {
      ed.classList.remove('is-empty')
    }
  }, [])

  const filteredFiles = workspaceFiles.filter((f) => {
    if (!fileFilter) return true
    const lower = fileFilter.toLowerCase()
    return f.toLowerCase().includes(lower) || basename(f).toLowerCase().includes(lower)
  })

  const filteredCommands = SLASH_COMMANDS.filter(
    (c) => c.command.startsWith(commandFilter) || c.label.includes(commandFilter.replace('/', ''))
  )

  // Insert file chip at @ position
  const insertFileRef = useCallback((filePath: string) => {
    const ed = editableRef.current
    if (!ed) return

    // Save trigger state before any DOM/state changes
    const atPos = atPosRef.current
    const currentFilter = fileFilter
    insertingRef.current = true

    // Do all DOM manipulation FIRST, while picker is still open and editor has context
    ed.focus()

    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) {
      atPosRef.current = -1
      setShowFilePicker(false)
      requestAnimationFrame(() => { insertingRef.current = false })
      return
    }

    if (atPos < 0) {
      // No active @ trigger — just insert at cursor
      const chip = createFileChipDOM(filePath, (el) => {
        el.remove()
        updateEmptyState()
      })
      const range = sel.getRangeAt(0)
      range.insertNode(chip)
      // Insert a zero-width text node after chip so cursor is visible
      const cursorNode = document.createTextNode('​')
      range.setStartAfter(chip)
      range.insertNode(cursorNode)
      range.setStartAfter(cursorNode)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      // Navigate to the @ position in the DOM
      let charCount = 0
      function findPos(node: Node, targetPos: number): { node: Node; offset: number } | null {
        if (node.nodeType === Node.TEXT_NODE) {
          const len = (node.textContent || '').length
          if (charCount + len >= targetPos) {
            return { node, offset: targetPos - charCount }
          }
          charCount += len
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement
          if (el.hasAttribute('data-file')) return null
          if (el.tagName === 'BR') charCount += 1
          else for (const c of Array.from(node.childNodes)) {
            const result = findPos(c, targetPos)
            if (result) return result
          }
        }
        return null
      }

      const found = findPos(ed, atPos)
      if (found) {
        // Delete @searchTerm text: from @ to end of search term
        const delLen = currentFilter.length + 1 // +1 for @
        const range = document.createRange()
        range.setStart(found.node, found.offset)
        range.setEnd(found.node, Math.min(found.offset + delLen, (found.node.textContent || '').length))
        range.deleteContents()

        // Insert chip after deletion
        const chip = createFileChipDOM(filePath, (el) => {
          el.remove()
          updateEmptyState()
        })
        range.insertNode(chip)
        // Insert a zero-width text node after chip so cursor is visible
        const cursorNode = document.createTextNode('​')
        range.setStartAfter(chip)
        range.insertNode(cursorNode)
        range.setStartAfter(cursorNode)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }

    // Close picker and reset state AFTER DOM changes
    atPosRef.current = -1
    setShowFilePicker(false)
    updateEmptyState()

    // Restore focus after React re-render closes the picker
    setTimeout(() => {
      ed.focus()
      // Place cursor at the end if it was lost
      const s = window.getSelection()
      if (s && ed.contains(s.anchorNode)) return // cursor survived, good
      const r = document.createRange()
      r.selectNodeContents(ed)
      r.collapse(false)
      s?.removeAllRanges()
      s?.addRange(r)
    }, 0)

    // Unlock selectionchange after a frame
    requestAnimationFrame(() => { insertingRef.current = false })
  }, [fileFilter, updateEmptyState])

  const insertCommand = useCallback((cmd: SlashCommand) => {
    const ed = editableRef.current
    if (!ed) return
    ed.focus()

    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0).cloneRange()
    range.setStart(ed, 0)
    const textBefore = range.toString()
    const lastNl = textBefore.lastIndexOf('\n')

    // Delete from @searchterm through cursor, insert command text
    const currentRange = sel.getRangeAt(0)
    let charIdx = 0
    function findNodeOffset(node: Node, target: number): { node: Node; offset: number } | null {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node.textContent || '').length
        if (charIdx + len >= target) return { node, offset: target - charIdx }
        charIdx += len
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        if (el.hasAttribute('data-file')) return null
        if (el.tagName === 'BR') charIdx += 1
        else for (const c of Array.from(node.childNodes)) {
          const r = findNodeOffset(c, target)
          if (r) return r
        }
      }
      return null
    }
    const start = findNodeOffset(ed, lastNl + 1)
    if (!start) return

    const newRange = document.createRange()
    newRange.setStart(start.node, start.offset)
    newRange.setEnd(currentRange.endContainer, currentRange.endOffset)
    newRange.deleteContents()
    newRange.insertNode(document.createTextNode(cmd.command + ' '))
    newRange.collapse(false)
    sel.removeAllRanges()
    sel.addRange(newRange)

    setShowCommands(false)
    updateEmptyState()
  }, [updateEmptyState])

  // Keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showFilePicker) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedFileIdx(p => Math.min(p + 1, filteredFiles.length - 1)); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedFileIdx(p => Math.max(p - 1, 0)); return }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          if (filteredFiles.length > 0) {
            const idx = selectedFileIdx < filteredFiles.length ? selectedFileIdx : 0
            insertFileRef(filteredFiles[idx])
          }
          return
        }
        if (e.key === 'Escape') { e.preventDefault(); setShowFilePicker(false); atPosRef.current = -1; return }
      }

      if (showCommands) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedCmdIdx(p => Math.min(p + 1, filteredCommands.length - 1)); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedCmdIdx(p => Math.max(p - 1, 0)); return }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          if (filteredCommands[selectedCmdIdx]) insertCommand(filteredCommands[selectedCmdIdx])
          return
        }
        if (e.key === 'Escape') { e.preventDefault(); setShowCommands(false); return }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [showFilePicker, showCommands, filteredFiles, filteredCommands, selectedFileIdx, selectedCmdIdx, insertFileRef, insertCommand]
  )

  const handleSend = useCallback(() => {
    const ed = editableRef.current
    if (!ed) return
    const { text, files } = readEditor(ed)
    const trimmed = text.trim()
    if (!trimmed) return
    if (!settings.workspacePath) {
      alert('请先选择工作空间（workspace）目录')
      return
    }
    sendMessage(trimmed, files.length > 0 ? files : undefined)
    ed.innerHTML = ''
    isEmptyRef.current = true
    updateEmptyState()
  }, [isProcessing, settings.workspacePath, sendMessage, updateEmptyState])

  const closeAllDropdowns = () => {
    setWsDropdown(false)
    setMdDropdown(false)
    setModeDropdown(false)
  }

  const handleSelectWorkspace = useCallback(async () => {
    setWsDropdown(false)
    const selected = await ipcClient.workspace.select()
    if (selected) {
      saveSettings({ workspacePath: selected })
    } else {
      const pasted = window.prompt('请输入工作空间目录路径：', settings.workspacePath || '')
      if (pasted && pasted.trim()) {
        saveSettings({ workspacePath: pasted.trim() })
      }
    }
  }, [saveSettings, settings.workspacePath])

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
              onMouseDown={(e) => { e.preventDefault(); insertCommand(cmd) }}
              onMouseEnter={() => setSelectedCmdIdx(idx)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-none bg-transparent cursor-pointer transition-colors ${idx === selectedCmdIdx ? 'bg-[#f0fdf4]' : 'hover:bg-[#f8fafc]'
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

      {/* @ File picker popup */}
      {showFilePicker && (
        <div
          ref={fileMenuRef}
          className="max-w-[740px] w-full mx-auto bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg overflow-hidden animate-[msgIn_0.15s_ease-out] max-h-[360px] overflow-y-auto"
        >
          {filesLoading ? (
            <div className="px-4 py-6 text-center text-[13px] text-[#94a3b8]">
              <div className="w-5 h-5 border-2 border-[#a7f3d0] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              正在加载文件列表...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[#94a3b8]">
              {workspaceFiles.length === 0 ? '工作空间暂无文件' : '无匹配文件'}
            </div>
          ) : (
            filteredFiles.slice(0, 100).map((filePath, idx) => (
              <button
                key={filePath}
                onMouseDown={(e) => { e.preventDefault(); insertFileRef(filePath) }}
                onMouseEnter={() => setSelectedFileIdx(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left border-none bg-transparent cursor-pointer transition-colors ${idx === selectedFileIdx ? 'bg-[#f0fdf4]' : 'hover:bg-[#f8fafc]'
                  } ${idx !== 0 ? 'border-t border-[#f1f5f9]' : ''}`}
              >
                <span className="text-[13px] text-[#0f172a] font-medium flex-1 truncate">
                  {basename(filePath)}
                </span>
                <span className="text-[11px] text-[#94a3b8] truncate max-w-[200px] hidden sm:block">
                  {filePath}
                </span>
              </button>
            )))}
        </div>
      )}

      {/* Input area */}
      <div className="max-w-[740px] w-full mx-auto border rounded-[24px] py-2.5 px-4 transition-colors focus-within:border-[#a7f3d0]"
        style={{ borderColor: 'rgba(0,0,0,.1)' }}
      >
        <div className="flex items-end gap-2">
          <div
            ref={editableRef}
            contentEditable={true}
            suppressContentEditableWarning
            onInput={updateEmptyState}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              e.preventDefault()
              const text = e.clipboardData.getData('text/plain')
              const sel = window.getSelection()
              if (sel && sel.rangeCount) {
                sel.getRangeAt(0).deleteContents()
                sel.getRangeAt(0).insertNode(document.createTextNode(text))
                sel.getRangeAt(0).collapse(false)
              }
            }}
            className={`flex-1 border-none bg-transparent outline-none text-[15px] text-[#0f172a] leading-relaxed min-h-[44px] max-h-[200px] overflow-y-auto py-1 whitespace-pre-wrap break-words ${isEmptyRef.current ? 'is-empty' : ''}`}
            data-placeholder="输入任务，@引用文件， /调用技能与指令"
            style={{ wordBreak: 'break-word' }}
            role="textbox"
            aria-multiline="true"
          />
          <button
            onClick={handleSend}
            className="flex-shrink-0 w-[32px] h-[32px] rounded-full flex items-center justify-center border-none cursor-pointer transition-all"
            style={{
              backgroundColor: isEmptyRef.current ? '#f1f5f9' : '#a7f3d0',
              color: isEmptyRef.current ? '#94a3b8' : '#047857',
              opacity: 1,
            }}
          >
            {isProcessing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="max-w-[740px] w-full mx-auto flex items-center gap-2">
        {/* Workspace selector */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setWsDropdown(!wsDropdown); setMdDropdown(false); setModeDropdown(false) }}
            className="flex items-center gap-1 py-[4px] px-2 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 5h3l1.5-2h4L12 5h2a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z" />
            </svg>
            <span title={settings.workspacePath || ''} className="font-medium text-[#64748b] text-[11px]">
              {settings.workspacePath || '请选择工作空间...'}
            </span>
            <svg className="w-3.5 h-3.5 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 7l3 3 3-3" />
            </svg>
          </button>
          {wsDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[220px] p-1 z-[100]">
              <div onClick={handleSelectWorkspace} className="px-3 py-2 rounded-md text-[13px] cursor-pointer flex items-center gap-2 text-[#0f172a] hover:bg-[#f1f5f9] transition-colors">
                <svg className="w-3.5 h-3.5 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 5h3l1.5-2h4L12 5h2a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z" />
                </svg>
                浏览选择目录...
              </div>
            </div>
          )}
        </div>

        {/* Model selector */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMdDropdown(!mdDropdown); setWsDropdown(false); setModeDropdown(false) }}
            className="flex items-center gap-1 py-[4px] px-2 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="3" /><path d="M13.5 8a5.5 5.5 0 00-11 0" />
            </svg>
            <span className="font-medium text-[#64748b] text-[11px]">{settings.model}</span>
            <svg className="w-3.5 h-3.5 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 7l3 3 3-3" />
            </svg>
          </button>
          {mdDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[200px] p-1 z-[100]">
              {MODELS.map((m) => (
                <div key={m} onClick={() => { saveSettings({ model: m }); closeAllDropdowns() }}
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
            className="flex items-center gap-1 py-[4px] px-2 border border-[#e2e8f0] rounded-md text-xs text-[#64748b] bg-white hover:border-[#cbd5e1] hover:bg-[#f8fafc] transition-colors cursor-pointer"
          >
            <span className="font-medium text-[11px]">
              {inputMode === 'build' ? 'Build' : inputMode === 'plan' ? 'Plan' : 'Ask'}
            </span>
            <svg className="w-3.5 h-3.5 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 7l3 3 3-3" />
            </svg>
          </button>
          {modeDropdown && (
            <div className="absolute bottom-full left-0 mb-1.5 bg-white border border-[#e2e8f0] rounded-[10px] shadow-lg min-w-[120px] p-1 z-[100]">
              {(['build', 'plan', 'ask'] as AppMode[]).map((m) => (
                <div key={m} onClick={() => { setInputMode(m); closeAllDropdowns() }}
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
          {isProcessing ? (queue.length > 0 ? `队列中 ${queue.length} 个待处理 · 输入将加入队列` : 'AI 正在处理中... Enter 加入队列') : 'Enter 发送 · Shift+Enter 换行'}
        </span>
      </div>

      <style>{`
        .is-empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}
