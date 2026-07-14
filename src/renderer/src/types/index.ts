export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
  timestamp: number
}

export type ToolType = 'glob' | 'read' | 'grep' | 'write' | 'edit'

export interface ToolCall {
  id: string
  type: ToolType
  args: Record<string, string>
  status: 'pending' | 'confirming' | 'executing' | 'done' | 'error'
  result?: string
  name?: string
}

export interface Settings {
  apiBaseUrl: string
  apiKey: string
  model: string
  workspacePath: string
  fullAccess: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: 'http://localhost:8080',
  apiKey: '',
  model: 'gpt-4',
  workspacePath: '',
  fullAccess: false
}

export interface Command {
  id: string
  trigger: string
  label: string
  description: string
}

export interface ElectronAPI {
  file: {
    glob: (pattern: string) => Promise<string[]>
    read: (path: string) => Promise<string>
    grep: (pattern: string, path: string) => Promise<string[]>
    write: (path: string, content: string) => Promise<void>
    edit: (path: string, oldStr: string, newStr: string) => Promise<void>
  }
  workspace: {
    select: () => Promise<string | null>
  }
  settings: {
    save: (settings: Settings) => Promise<void>
    load: () => Promise<Settings>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
