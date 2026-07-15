import { create } from 'zustand'
import type { Message, ServerEvent } from '../types'
import { sendChatMessage, reconnectStream, planApi, buildApi } from '../services/api'
import { useTaskStore } from './taskStore'
import { useQueueStore } from './queueStore'
import { useModeStore } from './modeStore'
import { useSettingsStore } from './settingsStore'

let msgIdCounter = 100
function genMsgId(): string {
  return `msg-${Date.now()}-${msgIdCounter++}`
}

// ===== Shared event handler factory =====
// Used by both sendMessage and reconnect to avoid code duplication.
// lastSeqRef is a mutable object so the caller can read the final seq after the stream ends.

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
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          content: m.content + event.delta
        }))
        break

      // ---- Tool Calls (agent-initiated) ----
      case 'agent.tool_call':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          tools: [
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
        }))
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
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          tools: [
            ...(m.tools || []),
            {
              id: event.request_id,
              name: event.tool_name,
              status: 'pending' as const,
              detail: typeof event.input === 'object'
                ? JSON.stringify(event.input).slice(0, 120)
                : undefined
            }
          ]
        }))
        break

      case 'client.tool_timeout':
        // Tool request timed out — could mark the tool as failed in the UI
        break

      // ---- Plan events ----
      case 'plan.generated':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          planGenerated: event.plan_text,
          planStatus: 'pending'
        }))
        break

      case 'plan.confirmed':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          planStatus: 'confirmed'
        }))
        break

      case 'plan.rejected':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          planStatus: 'rejected',
          processCollapsed: true
        }))
        break

      case 'plan.edited':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          planGenerated: event.new_plan_text
        }))
        break

      // ---- Build events ----
      case 'build.step_pending':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          tools: [
            ...(m.tools || []),
            {
              id: event.tool_call_id,
              name: event.tool_name,
              status: 'pending' as const,
              detail: event.reasoning || JSON.stringify(event.input).slice(0, 120)
            }
          ]
        }))
        break

      case 'build.step_confirmed':
        taskStore.updateLastAssistantMessage((m) => ({
          ...m,
          tools: m.tools?.map((t) =>
            t.id === event.tool_call_id
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
            content: m.content || `**Error:** ${event.error}`,
            isStreaming: false,
            processCollapsed: true
          }))
          taskStore.updateTaskSeq(lastSeqRef.current)
          set({ isProcessing: false })
        }
        break

      case 'message.waiting_timeout':
        // Server-side waiting timeout — could show a notification to the user
        break

      case 'message.queued':
        // Server confirmed the message is queued; queue position is in event.queue_position
        break

      case 'message.start':
        // Message processing started on server
        break

      case 'queue.updated':
        // Server sent updated queue state
        break

      // ---- Session events ----
      case 'session.timeout':
        // Session idle timeout warning — could show a toast notification
        break

      case 'session.recovered':
        // Session recovered after reconnect — could show a brief indicator
        break

      case 'heartbeat':
        // Keep-alive heartbeat from server; no action needed
        break

      default:
        // Exhaustiveness check — all ServerEvent types are handled above
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
  // Build mode
  confirmTool: () => void
  skipTool: () => void
  stopTools: () => void
  // Plan mode
  selectPlanOption: (msgIdx: number, value: string) => void
  answerPlanQuestion: (msgIdx: number, textAnswer?: string) => void
  confirmPlan: () => void
  editPlan: (msgIdx: number) => void
  rejectPlan: () => void
  // Plan editor
  openPlanEditor: (msgIdx: number, planText: string) => void
  closePlanEditor: () => void
  savePlanFromEditor: (newText: string) => void
  cancelPlanEdit: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  isProcessing: false,
  currentEditingPlanMsgIdx: null,

  // ===== SEND =====
  sendMessage: (text: string) => {
    if (!text) return

    // If already processing, queue the message
    if (get().isProcessing) {
      useQueueStore.getState().addToQueue(text)
      return
    }

    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    const modeStore = useModeStore.getState()
    const inputMode = modeStore.inputMode
    const sceneMode = modeStore.sceneMode

    // Add user message
    const userMsg: Message = {
      id: genMsgId(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    }
    taskStore.addMessage(userMsg)

    set({ isProcessing: true })

    // Create assistant placeholder message
    const assistantMsg: Message = {
      id: genMsgId(),
      role: 'assistant',
      content: '',
      thinking: '',
      tools: [],
      processCollapsed: false,
      isStreaming: true,
      timestamp: Date.now()
    }
    taskStore.addMessage(assistantMsg)

    // Mutable ref so createEventHandler can update seq and we can read the final value
    const lastSeqRef = { current: 0 }
    const handleEvent = createEventHandler(taskStore, set, lastSeqRef)

    // Read settings for workspace/model
    const settings = useSettingsStore.getState().settings

    // Fire the API call (async, runs in background via NDJSON stream)
    sendChatMessage({
      sessionId: task.id,
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
        // Process next queued message if any
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

  // ===== RECONNECT =====
  reconnect: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task || task.lastSeq === 0) return

    const lastSeqRef = { current: task.lastSeq }
    const handleEvent = createEventHandler(taskStore, set, lastSeqRef)

    reconnectStream(
      task.id,
      task.lastSeq,
      handleEvent,
      (err) => {
        console.error('Reconnect error:', err)
      },
      () => {
        taskStore.updateTaskSeq(lastSeqRef.current)
      }
    )
  },

  // ===== BUILD MODE =====
  confirmTool: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    buildApi.confirm(task.id).catch((err) => {
      console.error('Build confirm failed:', err)
    })
  },

  skipTool: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    buildApi.skip(task.id).catch((err) => {
      console.error('Build skip failed:', err)
    })
  },

  stopTools: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    buildApi.abort(task.id).catch((err) => {
      console.error('Build abort failed:', err)
    })
  },

  // ===== PLAN MODE =====
  selectPlanOption: (_msgIdx: number, _value: string) => {
    // UI-side only — selection tracking lives in the DOM
  },

  answerPlanQuestion: (_msgIdx: number, _textAnswer?: string) => {
    // Will be handled by plan question events from server
  },

  confirmPlan: () => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return

    // Optimistically update local state
    taskStore.updateLastAssistantMessage((m) => ({
      ...m,
      planStatus: 'confirmed'
    }))

    // Call API (fire-and-forget — stream handles the rest)
    planApi.confirm(task.id).catch((err) => {
      console.error('Plan confirm failed:', err)
      // Revert on failure
      taskStore.updateLastAssistantMessage((m) => ({
        ...m,
        planStatus: 'pending'
      }))
    })
  },

  editPlan: (msgIdx: number) => {
    const taskStore = useTaskStore.getState()
    const task = taskStore.getCurrentTask()
    if (!task) return
    const msg = task.messages[msgIdx]
    if (!msg?.planGenerated) return

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
      processCollapsed: true
    }))

    planApi.reject(task.id).catch((err) => {
      console.error('Plan reject failed:', err)
    })
  },

  // ===== PLAN EDITOR =====
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
        planGenerated: newText,
        planEditing: false
      }))
    }
    set({ currentEditingPlanMsgIdx: null })

    // Call API
    if (task) {
      planApi.edit(task.id, newText).catch((err) => {
        console.error('Plan edit API failed:', err)
      })
    }
  },

  cancelPlanEdit: () => {
    get().closePlanEditor()
  }
}))
