import { create } from 'zustand'
import type { Message, ServerEvent } from '../types'
import { sendChatMessage, reconnectStream, planApi, buildApi, executeClientTool, submitToolResult } from '../services/api'
import { useTaskStore } from './taskStore'
import { useQueueStore } from './queueStore'
import { useModeStore } from './modeStore'
import { useSettingsStore } from './settingsStore'

let msgIdCounter = 100
let planEventIdCounter = 1
function genMsgId(): string {
  return `msg-${Date.now()}-${msgIdCounter++}`
}
function genPlanEventId(): string {
  return `pe-${Date.now()}-${planEventIdCounter++}`
}

// Rebuild `content` from text-type segments only, excluding tool_call markers.
// This ensures raw tool call text that leaked through agent.text deltas is removed
// once the structured tool event fires and inserts a tool_call marker segment.
function rebuildContentFromSegments(
  m: { content: string; segments?: Array<{ type: string; content?: string }> }
): string {
  if (!m.segments || m.segments.length === 0) return m.content
  return m.segments
    .filter(s => s.type === 'text')
    .map(s => (s as { content: string }).content)
    .join('')
}

// Clean the last text segment by removing tool call raw text.
// Strategy: find any trailing JSON/XML artifact that mentions the tool name.
function cleanLastTextSegment(
  segs: Array<{ type: string; content?: string }>,
  toolName: string
) {
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].type === 'text' && segs[i].content) {
      const text = segs[i].content!
      // Remove trailing JSON that contains the tool name
      const cleaned = stripTrailingToolArtifact(text, toolName)
      segs[i] = { ...segs[i], content: cleaned }
      break
    }
  }
}

// Strip trailing text that looks like a tool call JSON/XML artifact.
// Uses the known tool name for precise matching.
function stripTrailingToolArtifact(text: string, toolName: string): string {
  let result = text

  // 1. Remove complete XML tool tags (anywhere)
  result = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  result = result.replace(/<tool_use>[\s\S]*?<\/tool_use>/gi, '')
  result = result.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  result = result.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')

  // 2. Remove trailing unclosed tool XML tags
  result = result.replace(/\s*<(?:tool_call|tool_use|function_calls|invoke)\b[\s\S]*$/gi, '')

  // 3. Find the tool name in the text (case-insensitive) and trim from the last JSON/XML structure before it.
  // This is the most reliable strategy: the raw tool text will contain the tool name.
  {
    const nameIdx = result.toLowerCase().indexOf(toolName.toLowerCase())
    if (nameIdx >= 0) {
      // Scan backwards from the tool name to find the start of the tool call artifact
      // Look for common delimiters: {, <, newline+space, etc.
      const before = result.slice(0, nameIdx)
      // Find the last "natural text boundary" before the tool name
      const boundaryMatch = before.match(/^(.*?)(?:\s*(?:\{|<(?:tool_call|tool_use|function_calls|invoke)\b))[\s\S]*$/i)
      if (boundaryMatch) {
        result = boundaryMatch[1].trimEnd()
      }
    }
  }

  // 4. Fallback: strip trailing unclosed JSON (brace counting)
  if (result === text) {
    let depth = 0
    let lastUnclosed = -1
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i] === '}') depth++
      else if (result[i] === '{') {
        if (depth === 0) { lastUnclosed = i; break }
        depth--
      }
    }
    if (lastUnclosed >= 0) {
      const tail = result.slice(lastUnclosed)
      if (/"(?:name|tool_name|tool_call|input|command|arguments)"/.test(tail)) {
        result = result.slice(0, lastUnclosed).trimEnd()
      }
    }
  }

  // 5. Fallback: strip complete trailing JSON object
  if (result === text) {
    const lastClose = result.lastIndexOf('}')
    if (lastClose >= 0) {
      let depth = 0, openPos = -1
      for (let i = lastClose; i >= 0; i--) {
        if (result[i] === '}') depth++
        else if (result[i] === '{') {
          depth--
          if (depth === 0) { openPos = i; break }
        }
      }
      if (openPos >= 0) {
        const block = result.slice(openPos, lastClose + 1)
        const after = result.slice(lastClose + 1).trim()
        if (/"(?:name|tool_name|tool_call)"\s*:/.test(block) &&
            (!after || /^(?:json|```|`)?\s*$/.test(after))) {
          result = result.slice(0, openPos).trimEnd()
        }
      }
    }
  }

  // 6. Remove markdown code fences wrapping tool JSON
  result = result.replace(/\s*```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '')

  // 7. Clean excessive whitespace
  result = result.replace(/\n{3,}/g, '\n\n')

  return result.trim()
}

// ===== Shared event handler factory =====
// Used by both sendMessage and reconnect to avoid code duplication.

function createEventHandler(
  taskStore: ReturnType<typeof useTaskStore.getState>,
  set: (partial: Partial<ChatState>) => void,
  lastSeqRef: { current: number }
): (event: ServerEvent) => void {
  return (event: ServerEvent) => {
    lastSeqRef.current = event.seq

    switch (event.type) {
      // ---- Thinking & Text ----
      case 'agent.thinking':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          thinking: (m.thinking || '') + event.delta
        }))
        break

      case 'agent.text':
        taskStore.updateLastAssistantMessage((m) => {
          const segs = m.segments || []
          const last = segs[segs.length - 1]
          let newSegments: typeof segs
          if (last?.type === 'text') {
            newSegments = [...segs]
            newSegments[newSegments.length - 1] = { ...last, content: last.content + event.delta }
          } else {
            // After a tool_call marker (or no segments), start a new text segment
            newSegments = [...segs, { type: 'text' as const, content: event.delta }]
          }
          return {
            ...m,
            content: m.content + event.delta,
            segments: newSegments
          }
        })
        break

      // ---- Tool Calls (agent-initiated) ----
      case 'agent.tool_call':
        taskStore.updateLastAssistantMessage((m) => {
          const segs = m.segments || []
          cleanLastTextSegment(segs, event.tool_name)
          // Rebuild content from clean segments
          m.content = rebuildContentFromSegments(m)
          // Also clean thinking text
          if (m.thinking) m.thinking = stripTrailingToolArtifact(m.thinking, event.tool_name)
          m.segments = segs
          // Insert tool_call marker for text ordering
          m.segments.push({ type: 'tool_call' as const, toolCall: null as any })
          m.tools = [
            ...(m.tools || []),
            {
              id: event.tool_call_id,
              name: event.tool_name,
              status: 'running' as const,
              detail: typeof event.input === 'object'
                ? JSON.stringify(event.input).slice(0, 120)
                : undefined
            }
          ]
          return { ...m }
        })
        break

      case 'agent.tool_result':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          tools: m.tools?.map((t) =>
            t.id === event.tool_call_id
              ? {
                  ...t,
                  status: 'done' as const,
                  result: event.result.output || event.result.error || 'Done'
                }
              : t
          )
        }))
        break

      // ---- Tool Requests (client-side, require user action) ----
      case 'client.tool_request':
        taskStore.updateLastAssistantMessage((m) => {
          const segs = m.segments || []
          cleanLastTextSegment(segs, event.tool_name)
          m.content = rebuildContentFromSegments(m)
          if (m.thinking) m.thinking = stripTrailingToolArtifact(m.thinking, event.tool_name)
          m.segments = segs
          m.segments.push({ type: 'tool_call' as const, toolCall: null as any })
          return { ...m }
        })

        // Auto-execute client tools silently and submit result to /tool-result
        {
          const task = taskStore.getCurrentTask()
          const workspace = useSettingsStore.getState().settings.workspacePath
          executeClientTool(event.tool_name, event.input, workspace).then((result) => {
            if (task?.sessionId) {
              submitToolResult(task.sessionId, event.request_id, result)
            }
          })
        }
        break

      case 'client.tool_timeout':
        break

      // ---- Plan events ----
      case 'plan.generated':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          planStatus: 'pending',
          segments: [
            ...(m.segments || []),
            {
              id: genPlanEventId(),
              timestamp: Date.now(),
              type: 'generated' as const
            }
          ]
        }))
        break

      case 'plan.question':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          segments: [
            ...(m.segments || []),
            {
              id: genPlanEventId(),
              timestamp: Date.now(),
              type: 'question' as const,
              question: event.question,
              options: event.options,
              input_type: event.input_type,
              answer: null
            }
          ]
        }))
        break

      case 'plan.question_timeout':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          segments: [
            ...(m.segments || []),
            {
              id: genPlanEventId(),
              timestamp: Date.now(),
              type: 'question' as const,
              answer: '(超时)'
            }
          ]
        }))
        break

      case 'plan.confirmed':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          planStatus: 'confirmed',
          segments: [
            ...(m.segments || []),
            {
              id: genPlanEventId(),
              timestamp: Date.now(),
              type: 'confirmed' as const
            }
          ]
        }))
        break

      case 'plan.rejected':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          planStatus: 'rejected',
          processCollapsed: true,
          segments: [
            ...(m.segments || []),
            {
              id: genPlanEventId(),
              timestamp: Date.now(),
              type: 'rejected' as const
            }
          ]
        }))
        break

      case 'plan.edited':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          segments: [
            ...(m.segments || []),
            {
              id: genPlanEventId(),
              timestamp: Date.now(),
              type: 'edited' as const
            }
          ]
        }))
        break

      // ---- Build events ----
      case 'build.step_pending':
        taskStore.updateLastAssistantMessage((m) => {
          const segs = m.segments || []
          cleanLastTextSegment(segs, event.tool_name)
          m.content = rebuildContentFromSegments(m)
          if (m.thinking) m.thinking = stripTrailingToolArtifact(m.thinking, event.tool_name)
          m.segments = segs
          m.segments.push({ type: 'tool_call' as const, toolCall: null as any })
          m.tools = [
            ...(m.tools || []),
            {
              id: event.tool_call_id,
              name: event.tool_name,
              status: 'pending' as const,
              command: event.input?.command as string | undefined,
              detail: event.reasoning || JSON.stringify(event.input).slice(0, 120)
            }
          ]
          return { ...m }
        })
        break

      case 'build.step_confirmed':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          tools: m.tools?.map((t) =>
            t.id === event.tool_call_id && t.status === 'pending'
              ? { ...t, status: 'running' as const }
              : t
          )
        }))
        break

      case 'build.step_skipped':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          tools: m.tools?.filter((t) => t.id !== event.tool_call_id)
        }))
        break

      case 'build.aborted':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          processCollapsed: true
        }))
        set({ isProcessing: false })
        break

      // ---- Lifecycle events ----
      case 'message.complete':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          processCollapsed: true,
          isStreaming: false
        }))
        taskStore.updateTaskSeq(lastSeqRef.current)
        set({ isProcessing: false })
        break

      case 'message.error':
        if (event.fatal) {
          taskStore.updateLastAssistantMessage((m) => ({
            ...m,
            content: m.content || `**Error:** ${event.message}`,
            isStreaming: false,
            processCollapsed: true
          }))
          taskStore.updateTaskSeq(lastSeqRef.current)
          set({ isProcessing: false })
        }
        break

      case 'message.waiting_timeout':
        break

      case 'message.queued':
        break

      case 'message.start':
        break

      case 'queue.updated':
        break

      // ---- Session events ----
      case 'session.timeout':
        break

      case 'session.recovered':
        break

      case 'system.status':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          segments: [
            ...(m.segments || []),
            { type: 'system_status' as const, message: event.message }
          ]
        }))
        break

      case 'heartbeat':
        break

      default:
        break
    }
  }
}

// ===== State =====

interface ChatState {
  isProcessing: boolean
  currentEditingPlanMsgIdx: number | null

  sendMessage: (text: string) => void
  reconnect: () => void
  confirmTool: () => void
  skipTool: () => void
  stopTools: () => void
  selectPlanOption: (msgIdx: number, value: string) => void
  answerPlanQuestion: (msgIdx: number, textAnswer?: string) => void
  confirmPlan: () => void
  editPlan: (msgIdx: number) => void
  rejectPlan: () => void
  openPlanEditor: (msgIdx: number, planText: string) => void
  closePlanEditor: () => void
  savePlanFromEditor: (newText: string) => void
  cancelPlanEdit: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  isProcessing: false,
  currentEditingPlanMsgIdx: null,

  sendMessage: (text: string) => {
    if (!text) return

    if (get().isProcessing) {
      useQueueStore.getState().addToQueue(text)
      return
    }

    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    if (!task.sessionId) {
      taskStore.addMessage({
        id: genMsgId(),
        role: 'assistant',
        content: '**Error:** 会话未创建，请重新创建任务',
        segments: [],
        timestamp: Date.now()
      })
      return
    }

    const modeStore = useModeStore.getState()
    const inputMode = modeStore.inputMode
    const sceneMode = modeStore.sceneMode

    const userMsg: Message = {
      id: genMsgId(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    }
    taskStore.addMessage(userMsg)

    set({ isProcessing: true })

    const assistantMsg: Message = {
      id: genMsgId(),
      role: 'assistant',
      content: '',
      thinking: '',
      tools: [],
      processCollapsed: false,
      isStreaming: true,
      segments: [],
      timestamp: Date.now()
    }
    taskStore.addMessage(assistantMsg)

    const lastSeqRef = { current: 0 }
    const handleEvent = createEventHandler(taskStore, set, lastSeqRef)

    const settings = useSettingsStore.getState().settings

    sendChatMessage({
      sessionId: task.sessionId,
      content: text,
      mode: inputMode,
      sceneMode: sceneMode,
      workspace: settings.workspacePath,
      model: settings.model,
      onEvent: handleEvent,
      onError: (err) => {
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          content: `**Error:** ${err.message}`,
          isStreaming: false,
          processCollapsed: true
        }))
        taskStore.updateTaskSeq(lastSeqRef.current)
        set({ isProcessing: false })
      },
      onDone: () => {
        const queueStore = useQueueStore.getState()
        if (queueStore.queue.length > 0) {
          setTimeout(() => {
            const next = queueStore.shiftQueue()
            if (next) {
              useChatStore.getState().sendMessage(next)
            }
          }, 300)
        }
      }
    })
  },

  reconnect: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task || task.lastSeq === 0) return

    set({ isProcessing: true })

    const lastSeqRef = { current: task.lastSeq }
    const handleEvent = createEventHandler(taskStore, set, lastSeqRef)

    reconnectStream(
      task.sessionId,
      task.lastSeq + 1,
      handleEvent,
      (err) => {
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          content: m.content || `**Reconnect Error:** ${err.message}`,
          isStreaming: false,
          processCollapsed: true
        }))
        taskStore.updateTaskSeq(lastSeqRef.current)
        set({ isProcessing: false })
      },
      () => {
        taskStore.updateTaskSeq(lastSeqRef.current)
      }
    )
  },

  confirmTool: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    const msg = task.messages[task.messages.length - 1]
    const pendingTool = msg?.tools?.find(t => t.status === 'pending')
    if (pendingTool) {
      taskStore.updateLastAssistantMessage((m) => ({
        ...m,
        tools: m.tools?.map((t) =>
          t.id === pendingTool.id ? { ...t, status: 'running' as const } : t
        )
      }))

      buildApi.confirm(task.sessionId, pendingTool.name).catch((err) => {
        console.error('Build confirm failed:', err)
      })
    }
  },

  skipTool: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    taskStore.updateLastAssistantMessage((m) => ({
      ...m,
      tools: m.tools?.filter(t => t.status !== 'pending')
    }))

    buildApi.skip(task.sessionId).catch((err) => {
      console.error('Build skip failed:', err)
    })
  },

  stopTools: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    taskStore.updateLastAssistantMessage((m) => ({
      ...m,
      tools: m.tools?.filter(t => t.status !== 'pending')
    }))

    buildApi.abort(task.sessionId).catch((err) => {
      console.error('Build abort failed:', err)
    })
  },

  selectPlanOption: (_msgIdx: number, _value: string) => {},

  answerPlanQuestion: (_msgIdx: number, textAnswer?: string) => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    const answer = textAnswer || '已选择'
    taskStore.updateLastAssistantMessage((m) => {
      const segs = m.segments || []
      const updated = segs.map((s, i) => {
        const isLastUnanswered =
          s.type === 'question' &&
          s.answer === null &&
          !segs.slice(i + 1).some(q => q.type === 'question' && q.answer === null)
        return isLastUnanswered ? { ...s, answer } : s
      })
      return { ...m, segments: updated }
    })

    planApi.answer(task.sessionId, answer).catch((err) => {
      console.error('Plan answer failed:', err)
    })
  },

  confirmPlan: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    taskStore.updateLastAssistantMessage((m) => ({
      ...m,
      planStatus: 'confirmed',
      segments: [
        ...(m.segments || []),
        {
          id: genPlanEventId(),
          timestamp: Date.now(),
          type: 'confirmed' as const
        }
      ]
    }))

    planApi.confirm(task.sessionId).catch((err) => {
      console.error('Plan confirm failed:', err)
      taskStore.updateLastAssistantMessage((m) => {
        const events = m.segments || []
        const reverted = events.filter((e, i) =>
          !(i === events.length - 1 && e.type === 'confirmed')
        )
        return { ...m, planStatus: 'pending', segments: reverted }
      })
    })
  },

  editPlan: (msgIdx: number) => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    taskStore.updateLastAssistantMessage((m) => ({ ...m, planEditing: true }))
    set({ currentEditingPlanMsgIdx: msgIdx })
  },

  rejectPlan: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    taskStore.updateLastAssistantMessage((m) => ({
      ...m,
      planStatus: 'rejected',
      processCollapsed: true,
      segments: [
        ...(m.segments || []),
        {
          id: genPlanEventId(),
          timestamp: Date.now(),
          type: 'rejected' as const
        }
      ]
    }))

    planApi.reject(task.sessionId).catch((err) => {
      console.error('Plan reject failed:', err)
    })
  },

  openPlanEditor: (msgIdx: number, _planText: string) => {
    set({ currentEditingPlanMsgIdx: msgIdx })
  },

  closePlanEditor: () => {
    const taskStore = useTaskStore.getState()
    const idx = get().currentEditingPlanMsgIdx
    if (idx != null) {
      taskStore.updateLastAssistantMessage((m) => ({ ...m, planEditing: false }))
    }
    set({ currentEditingPlanMsgIdx: null })
  },

  savePlanFromEditor: (newText: string) => {
    const idx = get().currentEditingPlanMsgIdx
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()

    if (idx != null) {
      taskStore.updateLastAssistantMessage((m) => ({
        ...m,
        planEditing: false,
        segments: [
          ...(m.segments || []),
          {
            id: genPlanEventId(),
            timestamp: Date.now(),
            type: 'edited' as const
          }
        ]
      }))
    }
    set({ currentEditingPlanMsgIdx: null })

    if (task) {
      planApi.edit(task.sessionId, newText).catch((err) => {
        console.error('Plan edit API failed:', err)
      })
    }
  },

  cancelPlanEdit: () => {
    get().closePlanEditor()
  }
}))
