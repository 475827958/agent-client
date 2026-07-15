import { create } from 'zustand'
import type { Task, Message } from '../types'
import { createSession } from '../services/api'

let nextId = 1
function genId(): string {
  return `task-${Date.now()}-${nextId++}`
}

function formatTime(ts: number): string {
  const d = new Date()
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

const DEMO_TASKS: Task[] = [
  {
    id: 'task-1',
    sessionId: '',
    title: '新建任务',
    time: '刚才',
    active: true,
    messages: [],
    lastSeq: 0
  },
  {
    id: 'task-2',
    sessionId: '',
    title: '分析 data-report 项目',
    time: '2小时前',
    active: false,
    lastSeq: 0,
    messages: [
      {
        id: 'msg-1', role: 'user', content: '帮我分析 /projects/data-report 目录下的代码结构，然后写一份 README', timestamp: Date.now() - 7200000
      },
      {
        id: 'msg-2', role: 'assistant', content: '分析完成。该项目是一个数据分析工具：\n\n- **main.py** — 入口文件，加载配置并启动分析器\n- **analyzer.py** — 核心数据分析模块\n- **config.yaml** — 项目配置\n- **utils.py** — 工具函数\n\n需要我继续生成 README 吗？',
        thinking: '用户想要分析项目目录结构并生成 README。需要先列出目录了解文件结构，再读取关键文件理解代码逻辑，最后总结分析结果。',
        processCollapsed: true,
        tools: [
          { id: 't1', name: '列出目录', command: 'ls -laR /projects/data-report/', detail: '/projects/data-report/', result: 'data-report/\n├── main.py\n├── analyzer.py\n├── config.yaml\n└── utils.py', status: 'done' },
          { id: 't2', name: '读取文件', command: 'cat /projects/data-report/main.py', detail: 'main.py', result: 'def main():\n    config = load_config("config.yaml")\n    analyzer = DataAnalyzer(config)\n    analyzer.run()', status: 'done' }
        ],
        timestamp: Date.now() - 7200000
      }
    ]
  },
  {
    id: 'task-3',
    sessionId: '',
    title: '编写数据分析脚本',
    time: '2小时前',
    active: false,
    lastSeq: 0,
    messages: []
  },
  {
    id: 'task-4',
    sessionId: '',
    title: '修复支付模块 Bug',
    time: '昨天',
    active: false,
    lastSeq: 0,
    messages: []
  }
]

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
  tasks: DEMO_TASKS,
  currentTaskId: 'task-1',

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

    const id = genId()
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
      const sessionId = await createSession()
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, sessionId } : t
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
    const newId = genId()
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
