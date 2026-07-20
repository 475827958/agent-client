import { create } from 'zustand'
import type { Task, Message } from '../types'
import { createSession, CLIENT_TOOLS } from '../services/api'
import { useModeStore } from './modeStore'
import { useSettingsStore } from './settingsStore'

function genUUID(): string {
  return crypto.randomUUID()
}

function formatTime(ts: number): string {
  const d = new Date()
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

interface TaskState {
  tasks: Task[]
  currentTaskId: string | null

  create: () => Promise<string>
  delete: (id: string) => void
  select: (id: string) => void
  rename: (id: string, title: string) => void
  duplicate: (id: string) => void
  addMessage: (message: Message) => void
  updateLastAssistantMessage: (updater: (msg: Message) => Message) => void
  updateTaskSeq: (seq: number) => void
  getCurrentTask: () => Task | undefined
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  currentTaskId: null,

  create: async () => {
    const state = get()
    // Dedup: if an empty "新建任务" already exists with a valid sessionId, just select it
    const existing = state.tasks.find(
      t => t.title === '新建任务' && t.messages.length === 0 && t.sessionId
    )
    if (existing) {
      set((s) => ({
        currentTaskId: existing.id,
        tasks: s.tasks.map((t) => ({ ...t, active: t.id === existing.id }))
      }))
      return existing.id
    }

    const id = genUUID()
    // Create local task placeholder first
    set((s) => ({
      tasks: [
        { id, sessionId: '', title: '新建任务', time: '刚才', active: false, messages: [], lastSeq: 0 },
        ...s.tasks.map((t) => ({ ...t, active: false }))
      ],
      currentTaskId: id
    }))

    // Call API to create server-side session
    try {
      const modeStore = useModeStore.getState()
      const settings = useSettingsStore.getState().settings

      const data = await createSession({
        id,
        scene_mode: modeStore.sceneMode,
        workspace: settings.workspacePath,
        model: settings.model,
        mode: modeStore.inputMode,
        client_tools: CLIENT_TOOLS
      })

      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, sessionId: data.id } : t
        )
      }))
    } catch (err) {
      console.error('Failed to create session:', err)
      // Task exists locally but has no server session — sendChatMessage will fail
    }

    return id
  },

  delete: (id: string) => {
    set((s) => {
      const filtered = s.tasks.filter((t) => t.id !== id)
      let currentId = s.currentTaskId
      if (s.currentTaskId === id) {
        currentId = filtered.length > 0 ? filtered[0].id : null
        if (currentId) {
          filtered[0] = { ...filtered[0], active: true }
        }
      }
      return { tasks: filtered, currentTaskId: currentId }
    })
  },

  select: (id: string) => {
    set((s) => ({
      currentTaskId: id,
      tasks: s.tasks.map((t) => ({ ...t, active: t.id === id }))
    }))
  },

  rename: (id: string, title: string) => {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, title } : t))
    }))
  },

  duplicate: (id: string) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return
    const newId = genUUID()
    set((s) => ({
      tasks: [
        {
          id: newId,
          sessionId: '',
          title: task.title + ' (副本)',
          time: '刚才',
          active: false,
          lastSeq: 0,
          messages: task.messages ? JSON.parse(JSON.stringify(task.messages)) : []
        },
        ...s.tasks
      ]
    }))
  },

  addMessage: (message: Message) => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== s.currentTaskId) return t
        const title =
          t.title === '新建任务' && message.role === 'user'
            ? message.content.slice(0, 40)
            : t.title
        return {
          ...t,
          title,
          time: formatTime(Date.now()),
          messages: [...t.messages, message]
        }
      })
    }))
  },

  updateLastAssistantMessage: (updater: (msg: Message) => Message) => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== s.currentTaskId) return t
        const messages = [...t.messages]
        const lastIdx = messages.length - 1
        if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = updater(messages[lastIdx])
        }
        return { ...t, messages, time: formatTime(Date.now()) }
      })
    }))
  },

  updateTaskSeq: (seq: number) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === s.currentTaskId ? { ...t, lastSeq: seq } : t
      )
    }))
  },

  getCurrentTask: () => {
    const state = get()
    return state.tasks.find((t) => t.id === state.currentTaskId)
  }
}))
