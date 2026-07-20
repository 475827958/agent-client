// ===== Modes =====
export type AppMode = 'ask' | 'plan' | 'build'
export type SceneMode = 'office' | 'code'

// ===== Tool Call =====
export interface ToolCall {
  id: string
  name: string
  command?: string
  detail?: string
  result?: string
  _result?: string
  input?: Record<string, unknown>
  status: 'pending' | 'running' | 'done'
}

// ===== Plan =====
export interface PlanEvent {
  id: string
  timestamp: number
  type: 'generated' | 'question' | 'confirmed' | 'rejected' | 'edited'
  question?: string
  options?: string[]
  input_type?: 'select' | 'text' | 'confirm'
  answer?: string | null
}

// ===== Message =====
export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'system_status'; message: string }
  | PlanEvent

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  tools?: ToolCall[]
  processCollapsed?: boolean
  segments?: MessageSegment[]
  planStatus?: 'pending' | 'confirmed' | 'rejected'
  planEditing?: boolean
  isStreaming?: boolean
  timestamp: number
}

// ===== Task (replaces Conversation) =====
export interface Task {
  id: string
  sessionId: string
  title: string
  time: string
  active: boolean
  messages: Message[]
  lastSeq: number
}

// ===== Settings =====
export interface Settings {
  apiBaseUrl: string
  apiKey: string
  model: string
  workspacePath: string
  fullAccess: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: '',
  apiKey: '',
  model: '/projects/data-report',
  workspacePath: '',
  fullAccess: false
}

// ===== Skills / MCP / Config =====
export interface HubSkill {
  id: string
  name: string
  desc: string
  icon: string
  category: string
}

export interface CustomSkill {
  id: string
  name: string
  desc: string
  icon: string
  source: 'create' | 'upload'
  fileName?: string
  time: string
}

export interface McpServer {
  id: string
  name: string
  desc: string
  icon: string
  category: string
}

export interface CustomMcp {
  id: string
  name: string
  desc: string
  icon: string
  source: 'create' | 'upload'
  fileName?: string
  time: string
}

export interface MemoryItem {
  id: string
  text: string
  time: string
}

export interface RuleItem {
  id: string
  text: string
  time: string
}

// ===== Commands =====
export interface Command {
  id: string
  trigger: string
  label: string
  description: string
}

// ===== Electron API =====
export interface ElectronAPI {
  file: {
    glob: (pattern: string) => Promise<string[]>
    read: (path: string) => Promise<string>
    grep: (pattern: string, path: string) => Promise<string[]>
    write: (path: string, content: string) => Promise<void>
    edit: (path: string, oldStr: string, newStr: string) => Promise<void>
    exec: (command: string, timeoutMs?: number) => Promise<{ stdout: string; stderr: string; exit_code: number }>
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

// ===== NDJSON Server Events (from spec section 1.9.2) =====
export type ServerEvent =
  // Thinking & Text
  | {
      type: 'agent.thinking'
      seq: number
      delta: string
      turn: number
      message_id: string
    }
  | {
      type: 'agent.text'
      seq: number
      delta: string
      turn: number
      message_id: string
    }
  // Tool calls
  | {
      type: 'agent.tool_call'
      seq: number
      tool_name: string
      tool_call_id: string
      input: Record<string, unknown>
      turn: number
      message_id: string
    }
  | {
      type: 'agent.tool_result'
      seq: number
      tool_call_id: string
      tool_name: string
      result: { success: boolean; output?: string; error?: string; duration_ms: number }
      turn: number
      message_id: string
    }
  | {
      type: 'client.tool_request'
      seq: number
      request_id: string
      tool_name: string
      input: Record<string, unknown>
      message_id: string
    }
  | {
      type: 'client.tool_timeout'
      seq: number
      request_id: string
      message: string
    }
  // Plan mode
  | {
      type: 'plan.generated'
      seq: number
      message_id: string
    }
  | {
      type: 'plan.question'
      seq: number
      message_id: string
      question: string
      options?: string[]
      input_type: 'select' | 'text' | 'confirm'
      context?: string
    }
  | { type: 'plan.question_timeout'; seq: number; message_id: string }
  | { type: 'plan.confirmed'; seq: number; message_id: string }
  | { type: 'plan.rejected'; seq: number; message_id: string }
  | { type: 'plan.edited'; seq: number; message_id: string; new_plan_text: string }
  // Build mode
  | {
      type: 'build.step_pending'
      seq: number
      message_id: string
      tool_name: string
      tool_call_id: string
      input: Record<string, unknown>
      step: number
      reasoning?: string
    }
  | { type: 'build.step_confirmed'; seq: number; step: number; tool_name: string; tool_call_id: string }
  | { type: 'build.step_skipped'; seq: number; step: number; tool_name: string; tool_call_id: string }
  | { type: 'build.aborted'; seq: number; message_id: string }
  // Queue & Lifecycle
  | {
      type: 'queue.updated'
      seq: number
      session_id: string
      queue: { message_id: string; content_preview: string; queue_position: number; status: 'pending' }[]
      current_processing_id: string | null
    }
  | {
      type: 'message.queued'
      seq: number
      message_id: string
      queue_position: number
      queue_size: number
    }
  | {
      type: 'message.start'
      seq: number
      message_id: string
      mode: AppMode
      scene_mode: SceneMode
      workspace: string
    }
  | {
      type: 'message.complete'
      seq: number
      message_id: string
      summary: {
        turns: number
        tokens_in: number
        tokens_out: number
        duration_ms: number
        tool_calls_count: number
      }
    }
  | {
      type: 'message.error'
      seq: number
      message_id: string
      error: string
      code: string
      fatal: boolean
      turn?: number
    }
  | {
      type: 'message.waiting_timeout'
      seq: number
      message_id: string
      reason: 'plan_confirm_timeout' | 'build_confirm_timeout' | 'tool_result_timeout'
    }
  | { type: 'session.timeout'; seq: number; idle_minutes: number; archive_at: string }
  | { type: 'heartbeat'; seq: number; timestamp: number }
  | {
      type: 'session.recovered'
      seq: number
      current_message_id: string | null
      queue_size: number
    }
  | {
      type: 'system.status'
      seq: number
      message: string
    }
