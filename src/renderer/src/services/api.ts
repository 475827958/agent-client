import type { ServerEvent, AppMode, SceneMode, McpHubServer, McpInstalledServer, CustomMcpServer, CreateCustomMcpRequest, HubSkill, InstalledSkill, CustomSkillDef, CreateCustomSkillRequest, McpInstallResponse, McpToolDef, SkillInstallResult } from '../types'
import { useSettingsStore } from '../stores/settingsStore'
import { parseNDJSONStream } from './ndjson'
import { ipcClient } from './ipcClient'

const DEFAULT_BASE_URL = '/api'

/** Skills directory on the client machine */
const HOME_DIR = (() => {
  try {
    return (window as any).__HOME_DIR || ''
  } catch { return '' }
})()
const SKILLS_BASE_DIR = HOME_DIR ? `${HOME_DIR}/.iwork/skills` : ''

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // strip data:application/zip;base64, prefix
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function extractSkillZip(skillId: string, skillName: string, blob: Blob): Promise<string> {
  if (!SKILLS_BASE_DIR) {
    console.warn('HOME_DIR not available, skipping zip extraction')
    return ''
  }

  const targetDir = `${SKILLS_BASE_DIR}/${skillName}`
  const b64Path = `${SKILLS_BASE_DIR}/_tmp_${skillId}.b64`
  const zipPath = `${SKILLS_BASE_DIR}/_tmp_${skillId}.zip`

  const base64 = await blobToBase64(blob)

  // Write base64 to temp file, decode, extract, cleanup
  await ipcClient.file.write(b64Path, base64)
  await ipcClient.file.exec(`mkdir -p "${targetDir}" && base64 -d "${b64Path}" > "${zipPath}" && unzip -o "${zipPath}" -d "${targetDir}" && rm "${b64Path}" "${zipPath}"`)

  return targetDir
}

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
 * Try to execute a tool as an MCP tool call.
 * Tool names from the backend follow the pattern {server_id}_{tool_name}.
 * Returns the result if matched, or null if not an MCP tool.
 */
async function tryExecuteMcpTool(toolName: string, input: Record<string, unknown>): Promise<unknown | null> {
  // Lazy import to avoid circular dependency with configStore
  const { useConfigStore } = await import('../stores/configStore')
  const { mcpConnectionStatuses } = useConfigStore.getState()

  for (const serverId of Object.keys(mcpConnectionStatuses)) {
    const prefix = serverId + '_'
    if (toolName.startsWith(prefix) && mcpConnectionStatuses[serverId].status === 'connected') {
      const actualToolName = toolName.slice(prefix.length)
      return ipcClient.mcp.callTool(serverId, actualToolName, input)
    }
  }

  return null
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
      default: {
        // Route MCP tools: tool name format is {server_id}_{tool_name}
        const mcpResult = await tryExecuteMcpTool(toolName, input)
        if (mcpResult !== null) {
          output = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult)
        } else {
          throw new Error(`Unknown client tool: ${toolName}`)
        }
      }
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
        "Accept": "application/json, text/event-stream",
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

// ===== MCP 管理 API (section 2.9) =====

function getAuthHeaders(): Record<string, string> {
  const settings = useSettingsStore.getState().settings
  return {
    'Content-Type': 'application/json',
    Authorization: settings.apiKey ? `Bearer ${settings.apiKey}` : ''
  }
}

function getMcpUrl(path: string): string {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  return `${baseUrl}${path}`
}

// GET /mcp/hub
export async function fetchMcpHub(): Promise<{ servers: McpHubServer[] }> {
  const response = await fetch(getMcpUrl('/mcp/hub'), { headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`MCP Hub fetch error: ${response.status}`)
  return response.json()
}

// GET /mcp/installed
export async function fetchMcpInstalled(): Promise<{ installed: McpInstalledServer[] }> {
  const response = await fetch(getMcpUrl('/mcp/installed'), { headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`MCP Installed fetch error: ${response.status}`)
  return response.json()
}

// POST /mcp/install — 服务端登记 + 返回完整配置，客户端按 transport 建立连接
export async function installMcpApi(serverId: string): Promise<McpInstallResponse> {
  const response = await fetch(getMcpUrl('/mcp/install'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ server_id: serverId })
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Install failed' }))
    if (response.status === 409) throw new Error('该 MCP 已安装')
    if (response.status === 404) throw new Error('server_id 不在 Hub 中')
    throw new Error(err.detail || `MCP install error: ${response.status}`)
  }
  return response.json()
}

// DELETE /mcp/uninstall/{server_id}
export async function uninstallMcpApi(serverId: string): Promise<{ uninstalled: boolean; server_id: string }> {
  const response = await fetch(getMcpUrl(`/mcp/uninstall/${serverId}`), {
    method: 'DELETE',
    headers: getAuthHeaders()
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Uninstall failed' }))
    throw new Error(err.detail || `MCP uninstall error: ${response.status}`)
  }
  return response.json()
}

// GET /mcp/custom
export async function fetchMcpCustom(): Promise<{ custom: CustomMcpServer[] }> {
  const response = await fetch(getMcpUrl('/mcp/custom'), { headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`MCP Custom fetch error: ${response.status}`)
  return response.json()
}

// POST /mcp/custom
export async function createCustomMcpApi(req: CreateCustomMcpRequest): Promise<CustomMcpServer> {
  const response = await fetch(getMcpUrl('/mcp/custom'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(req)
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Create custom MCP failed' }))
    throw new Error(err.detail || `MCP custom create error: ${response.status}`)
  }
  return response.json()
}

// DELETE /mcp/custom/{server_id}
export async function deleteCustomMcpApi(serverId: string): Promise<{ deleted: boolean; server_id: string }> {
  const response = await fetch(getMcpUrl(`/mcp/custom/${serverId}`), {
    method: 'DELETE',
    headers: getAuthHeaders()
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Delete custom MCP failed' }))
    throw new Error(err.detail || `MCP custom delete error: ${response.status}`)
  }
  return response.json()
}

// POST /sessions/{id}/mcp/tools — 客户端发现 MCP 工具后上报
export async function reportMcpTools(
  sessionId: string,
  serverId: string,
  tools: McpToolDef[]
): Promise<{ received: boolean; tool_count: number }> {
  const response = await fetch(getMcpUrl(`/sessions/${sessionId}/mcp/tools`), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ server_id: serverId, tools })
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Report tools failed' }))
    throw new Error(err.detail || `MCP tools report error: ${response.status}`)
  }
  return response.json()
}

// ===== Skill 管理 API (section 3.9) =====

function getSkillUrl(path: string): string {
  const settings = useSettingsStore.getState().settings
  const baseUrl = settings.apiBaseUrl || DEFAULT_BASE_URL
  return `${baseUrl}${path}`
}

// GET /skills/hub
export async function fetchSkillHub(): Promise<{ skills: HubSkill[] }> {
  const response = await fetch(getSkillUrl('/skills/hub'), { headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`Skill Hub fetch error: ${response.status}`)
  return response.json()
}

// GET /skills/installed
export async function fetchInstalledSkills(): Promise<{ installed: InstalledSkill[] }> {
  const response = await fetch(getSkillUrl('/skills/installed'), { headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`Skill Installed fetch error: ${response.status}`)
  return response.json()
}

// POST /skills/install — 服务端登记 + 返回 zip，客户端解压到 ~/.iwork/skills/{name}/
export async function installSkillApi(skillId: string): Promise<SkillInstallResult> {
  const response = await fetch(getSkillUrl('/skills/install'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ skill_id: skillId })
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Install failed' }))
    if (response.status === 409) throw new Error('该 Skill 已安装')
    if (response.status === 404) throw new Error('skill_id 不在 Hub 中')
    throw new Error(err.detail || `Skill install error: ${response.status}`)
  }

  // Check if response is JSON (legacy/no zip) or a zip blob
  const contentType = response.headers.get('Content-Type') || ''
  if (contentType.includes('application/zip')) {
    const skillName = response.headers.get('X-Skill-Name') || skillId
    const blob = await response.blob()
    const extractPath = await extractSkillZip(skillId, skillName, blob)
    return { skill_id: skillId, skill_name: skillName, extract_path: extractPath }
  }

  // Fallback: old JSON response
  const data = await response.json()
  return { skill_id: skillId, skill_name: data.skill_name || skillId, extract_path: '' }
}

// DELETE /skills/uninstall/{skill_id}
export async function uninstallSkillApi(skillId: string): Promise<{ uninstalled: boolean; skill_id: string }> {
  const response = await fetch(getSkillUrl(`/skills/uninstall/${skillId}`), {
    method: 'DELETE',
    headers: getAuthHeaders()
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Uninstall failed' }))
    throw new Error(err.detail || `Skill uninstall error: ${response.status}`)
  }
  return response.json()
}

// POST /skills/enable
export async function enableSkillApi(skillId: string): Promise<{ enabled: boolean; skill_id: string }> {
  const response = await fetch(getSkillUrl('/skills/enable'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ skill_id: skillId })
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Enable failed' }))
    throw new Error(err.detail || `Skill enable error: ${response.status}`)
  }
  return response.json()
}

// POST /skills/disable
export async function disableSkillApi(skillId: string): Promise<{ disabled: boolean; skill_id: string }> {
  const response = await fetch(getSkillUrl('/skills/disable'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ skill_id: skillId })
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Disable failed' }))
    throw new Error(err.detail || `Skill disable error: ${response.status}`)
  }
  return response.json()
}

// GET /skills/custom
export async function fetchCustomSkillsApi(): Promise<{ custom: CustomSkillDef[] }> {
  const response = await fetch(getSkillUrl('/skills/custom'), { headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`Custom Skills fetch error: ${response.status}`)
  return response.json()
}

// POST /skills/custom
export async function createCustomSkillApi(req: CreateCustomSkillRequest): Promise<CustomSkillDef> {
  const response = await fetch(getSkillUrl('/skills/custom'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(req)
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Create custom skill failed' }))
    throw new Error(err.detail || `Custom skill create error: ${response.status}`)
  }
  return response.json()
}

// PUT /skills/custom/{skill_id}
export async function updateCustomSkillApi(skillId: string, req: Partial<CreateCustomSkillRequest>): Promise<{ updated: boolean; skill_id: string }> {
  const response = await fetch(getSkillUrl(`/skills/custom/${skillId}`), {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(req)
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Update custom skill failed' }))
    throw new Error(err.detail || `Custom skill update error: ${response.status}`)
  }
  return response.json()
}

// DELETE /skills/custom/{skill_id}
export async function deleteCustomSkillApi(skillId: string): Promise<{ deleted: boolean; skill_id: string }> {
  const response = await fetch(getSkillUrl(`/skills/custom/${skillId}`), {
    method: 'DELETE',
    headers: getAuthHeaders()
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Delete custom skill failed' }))
    throw new Error(err.detail || `Custom skill delete error: ${response.status}`)
  }
  return response.json()
}
