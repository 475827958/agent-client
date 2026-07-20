import type { ServerEvent, AppMode, SceneMode } from '../types'
import { useSettingsStore } from '../stores/settingsStore'
import { parseNDJSONStream } from './ndjson'
import { ipcClient } from './ipcClient'

const DEFAULT_BASE_URL = '/api'

export interface ToolResult {
  status: 'success' | 'error'
  output?: string
  error?: string
  exit_code?: number
  duration_ms: number
}

export function isClientTool(toolName: string): boolean {
  return CLIENT_TOOLS.some(t => t.name === toolName)
}

/**
 * Validate and resolve a path relative to workspaceRoot.
 * Pure string logic — no Node deps, works in browser dev mode.
 */
function resolveWorkspacePath(workspaceRoot: string, targetPath: string): string {
  const sep = workspaceRoot.includes('\\') ? '\\' : '/'
  const isWin = sep === '\\'

  // Absolute path: must start with workspaceRoot
  if (targetPath.match(/^[A-Za-z]:[\\/]/) || targetPath.startsWith('/')) {
    const target = isWin ? targetPath.replace(/\//g, '\\') : targetPath
    const root = isWin
      ? workspaceRoot.replace(/[\\/]+$/, '').replace(/\//g, '\\')
      : workspaceRoot.replace(/[\\/]+$/, '')

    const tLower = isWin ? target.toLowerCase() : target
    const rLower = isWin ? root.toLowerCase() : root
    if (!tLower.startsWith(rLower + (isWin ? '\\' : '/'))) {
      throw new Error('Access outside workspace is not allowed')
    }
    return target
  }

  // Relative path: resolve from workspaceRoot, reject .. that escapes
  const rootParts = workspaceRoot.replace(/[\\/]+$/, '').split(/[\\/]/)
  const targetParts = targetPath.replace(/\\/g, '/').split('/')
  const parts: string[] = []

  for (const part of [...rootParts, ...targetParts]) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (parts.length <= rootParts.length) {
        throw new Error('Access outside workspace is not allowed')
      }
      parts.pop()
    } else {
      parts.push(part)
    }
  }

  if (parts.length < rootParts.length) {
    throw new Error('Access outside workspace is not allowed')
  }

  return parts.join(sep)
}

export async function executeClientTool(
  toolName: string,
  input: Record<string, unknown>,
  workspacePath: string
): Promise<ToolResult> {
  const start = Date.now()

  try {
    let output: string | undefined

    switch (toolName) {
      case 'read_file': {
        const filePath = input.path as string
        if (!filePath) throw new Error('Missing required parameter: path')
        resolveWorkspacePath(workspacePath, filePath) // validate
        output = await ipcClient.file.read(filePath)
        break
      }
      case 'write_file': {
        const filePath = input.path as string
        const content = input.content as string
        if (!filePath) throw new Error('Missing required parameter: path')
        if (content === undefined) throw new Error('Missing required parameter: content')
        resolveWorkspacePath(workspacePath, filePath)
        await ipcClient.file.write(filePath, content)
        output = 'File written successfully'
        break
      }
      case 'edit_file': {
        const filePath = input.path as string
        const oldString = input.old_string as string
        const newString = input.new_string as string
        if (!filePath) throw new Error('Missing required parameter: path')
        if (oldString === undefined) throw new Error('Missing required parameter: old_string')
        if (newString === undefined) throw new Error('Missing required parameter: new_string')
        resolveWorkspacePath(workspacePath, filePath)
        await ipcClient.file.edit(filePath, oldString, newString)
        output = 'File edited successfully'
        break
      }
      case 'glob': {
        const pattern = input.pattern as string
        if (!pattern) throw new Error('Missing required parameter: pattern')
        const files = await ipcClient.file.glob(pattern)
        output = files.join('\n') || '(no matches)'
        break
      }
      case 'grep': {
        const pattern = input.pattern as string
        if (!pattern) throw new Error('Missing required parameter: pattern')
        const dirPath = (input.path as string) || '.'
        resolveWorkspacePath(workspacePath, dirPath)
        const lines = await ipcClient.file.grep(pattern, dirPath)
        output = lines.join('\n') || '(no matches)'
        break
      }
      case 'bash': {
        const command = input.command as string
        if (!command) throw new Error('Missing required parameter: command')
        const timeoutMs = (input.timeout_ms as number) || 120000
        const result = await ipcClient.file.exec(command, timeoutMs)
        if (result.exit_code !== 0 && result.stderr) {
          return {
            status: 'error',
            error: result.stderr,
            output: result.stdout,
            exit_code: result.exit_code,
            duration_ms: Date.now() - start
          }
        }
        output = result.stdout || result.stderr || '(no output)'
        break
      }
      default:
        throw new Error(`Unknown client tool: ${toolName}`)
    }

    return {
      status: 'success',
      output,
      duration_ms: Date.now() - start
    }
  } catch (err: any) {
    return {
      status: 'error',
      error: err?.message || String(err),
      duration_ms: Date.now() - start
    }
  }
}

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
  id: string
  title: string
  mode: string
  scene_mode: string
  model: string
  workspace: string
  client_tools_count: number
  mcp_servers_count: number
  created_at: string
}

export const CLIENT_TOOLS = [
  {
    name: 'bash',
    description: '执行 shell 命令',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds, default 120000' }
      },
      required: ['command']
    }
  },
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

export async function createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions`

  console.log('创建会话')

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
    } catch { }
    throw new Error(msg)
  }

  const data: CreateSessionResponse = await response.json()
  return data
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
      } catch { }
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

async function planAction(sessionId: string, action: 'confirm' | 'edit' | 'reject' | 'answer', body?: Record<string, unknown>): Promise<void> {
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
  reject: (sessionId: string) => planAction(sessionId, 'reject'),
  answer: (sessionId: string, answer: string) => planAction(sessionId, 'answer', { answer })
}

// ===== Build actions =====

async function buildAction(sessionId: string, action: 'confirm' | 'skip' | 'abort', toolName?: string): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  const url = `${baseUrl}/sessions/${sessionId}/build/${action}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
    },
    body: toolName ? JSON.stringify({ tool_name: toolName }) : undefined
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(err.message || `Build ${action} failed`)
  }
}

export const buildApi = {
  confirm: (sessionId: string, toolName?: string) => buildAction(sessionId, 'confirm', toolName),
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
