import type { ServerEvent, AppMode, SceneMode } from '../types'
import { useSettingsStore } from '../stores/settingsStore'
import { parseNDJSONStream } from './ndjson'

const DEFAULT_BASE_URL = '/api'

// ===== Session management =====

export interface CreateSessionRequest {
  id: string
  scene_mode: string
  workspace: string
  model: string
  mode: string
  client_tools: {
    name: string
    description: string
    input_schema: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }[]
  mcp_servers?: {
    server_id: string
    server_name: string
    enabled_tools?: string[]
  }[]
}

export interface CreateSessionResponse {
  session_id: string
}

export const CLIENT_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the file' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Perform exact string replacements in a file',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        old_string: { type: 'string', description: 'Text to replace' },
        new_string: { type: 'string', description: 'Replacement text' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match, e.g. **/*.ts' },
        path: { type: 'string', description: 'Directory to search in' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep',
    description: 'Search file contents using regex patterns',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for' },
        path: { type: 'string', description: 'File or directory to search in' },
        glob: { type: 'string', description: 'Glob pattern to filter files' }
      },
      required: ['pattern']
    }
  }
]

export async function createSession(req: CreateSessionRequest): Promise<string> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
    },
    body: JSON.stringify(req)
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    let msg = `Create session error: ${response.status} ${response.statusText}`
    try {
      const parsed = JSON.parse(errBody)
      if (parsed.message) msg = parsed.message
      if (parsed.error) msg = parsed.error
    } catch {}
    throw new Error(msg)
  }

  const data: CreateSessionResponse = await response.json()
  return data.session_id
}

// ===== Main chat channel =====

export interface ChatStreamOptions {
  sessionId: string
  content: string
  mode: AppMode
  sceneMode: SceneMode
  workspace: string
  model: string
  files?: string[]
  skillInvocations?: { skill_id: string; skill_name: string }[]
  mcpServers?: { server_id: string; server_name: string; enabled_tools?: string[] }[]
  onEvent: (event: ServerEvent) => void
  onError: (err: Error) => void
  onDone: () => void
}

export async function sendChatMessage(opts: ChatStreamOptions): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${opts.sessionId}/messages`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
      },
      body: JSON.stringify({
        content: opts.content,
        scene_mode: opts.sceneMode,
        workspace: opts.workspace,
        model: opts.model,
        mode: opts.mode,
        files: opts.files,
        skill_invocations: opts.skillInvocations,
        mcp_servers: opts.mcpServers
      })
    })

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      let msg = `API error: ${response.status} ${response.statusText}`
      try {
        const parsed = JSON.parse(errBody)
        if (parsed.message) msg = parsed.message
        if (parsed.error) msg = parsed.error
      } catch {}
      throw new Error(msg)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Response body is not readable')

    for await (const event of parseNDJSONStream(reader)) {
      opts.onEvent(event)
      if (event.type === 'message.complete' || (event.type === 'message.error' && event.fatal)) {
        opts.onDone()
        return
      }
    }

    opts.onDone()
  } catch (err) {
    opts.onError(err instanceof Error ? err : new Error(String(err)))
  }
}

// ===== Reconnection =====

export async function reconnectStream(
  sessionId: string,
  sinceSeq: number,
  onEvent: (event: ServerEvent) => void,
  onError: (err: Error) => void,
  onDone: () => void
): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${sessionId}/stream?since_seq=${sinceSeq}`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
      }
    })

    if (!response.ok) throw new Error(`Reconnect error: ${response.status}`)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Response body is not readable')

    for await (const event of parseNDJSONStream(reader)) {
      onEvent(event)
      if (event.type === 'message.complete' || (event.type === 'message.error' && event.fatal)) {
        onDone()
        return
      }
    }
    onDone()
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}

// ===== Plan actions =====

async function planAction(sessionId: string, action: 'confirm' | 'edit' | 'reject', body?: Record<string, unknown>): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${sessionId}/plan/${action}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
    },
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(err.message || `Plan ${action} failed`)
  }
}

export const planApi = {
  confirm: (sessionId: string) => planAction(sessionId, 'confirm'),
  edit: (sessionId: string, planText: string) => planAction(sessionId, 'edit', { plan_text: planText }),
  reject: (sessionId: string) => planAction(sessionId, 'reject')
}

// ===== Build actions =====

async function buildAction(sessionId: string, action: 'confirm' | 'skip' | 'abort'): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${sessionId}/build/${action}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
    }
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(err.message || `Build ${action} failed`)
  }
}

export const buildApi = {
  confirm: (sessionId: string) => buildAction(sessionId, 'confirm'),
  skip: (sessionId: string) => buildAction(sessionId, 'skip'),
  abort: (sessionId: string) => buildAction(sessionId, 'abort')
}

// ===== Tool result =====

export async function submitToolResult(
  sessionId: string,
  requestId: string,
  result: { status: 'success' | 'error'; output?: string; error?: string; exit_code?: number; duration_ms: number }
): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${sessionId}/tool-result/${requestId}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
    },
    body: JSON.stringify(result)
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(err.message || 'Tool result submission failed')
  }
}

// ===== Queue =====

export async function fetchQueue(sessionId: string): Promise<{
  session_id: string
  queue: { message_id: string; content_preview: string; queue_position: number; status: string; created_at: string }[]
  current_processing: { message_id: string; content_preview: string; started_at: string } | null
}> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${sessionId}/queue`

  const response = await fetch(url, {
    headers: {
      Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
    }
  })

  if (!response.ok) throw new Error(`Queue fetch error: ${response.status}`)
  return response.json()
}

export async function removeFromQueue(sessionId: string, msgId: string): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${sessionId}/queue/${msgId}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
    }
  })

  if (!response.ok) throw new Error(`Queue remove error: ${response.status}`)
}
