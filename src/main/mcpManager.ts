import { spawn, ChildProcess } from 'child_process'
import * as readline from 'readline'

// ===== Types =====

export interface McpServerConfig {
  server_id: string
  transport: 'stdio' | 'sse' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface McpToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ===== Helpers =====

let nextGlobalId = 1

function resolveEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '')
}

function resolveEnvVars(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined
  const resolved: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    resolved[k] = resolveEnv(v)
  }
  return resolved
}

// ===== Stdio Connection =====

class StdioConnection {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>()
  private buffer = ''

  constructor(private config: McpServerConfig) {}

  async connect(): Promise<McpToolDef[]> {
    const send = (req: JsonRpcRequest) => this.sendRpc(req)
    await this.spawnProcess()
    await this.initialize(send)
    return this.listTools(send)
  }

  private spawnProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = this.config.command!
      const args = this.config.args || []
      const env = {
        ...process.env,
        ...resolveEnvVars(this.config.env)
      }

      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: process.platform === 'win32'
      })

      this.process = child

      const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity })
      rl.on('line', (line: string) => {
        try {
          const msg = JSON.parse(line)
          if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!
            this.pending.delete(msg.id)
            p.resolve(msg)
          }
        } catch {
          // skip non-JSON lines (e.g. debug output on stdout)
        }
      })

      let stderrLog = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderrLog += data.toString()
      })

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn ${command}: ${err.message}`))
      })

      child.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          const errMsg = stderrLog.trim() || `Process exited with code ${code}`
          // Reject all pending
          for (const [, p] of this.pending) {
            p.reject(new Error(errMsg))
          }
          this.pending.clear()
        }
      })

      // Give the process a moment to start, then resolve
      setTimeout(() => resolve(), 200)
    })
  }

  private sendRpc(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error('Process not running'))
        return
      }

      const id = this.nextId++
      const request = { ...req, id }
      this.pending.set(id, { resolve, reject })

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${req.method}`))
      }, 30000)

      // Wrap to clear timeout
      const origResolve = resolve
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); origResolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) }
      })

      this.process!.stdin!.write(JSON.stringify(request) + '\n')
    })
  }

  private async initialize(send: (req: JsonRpcRequest) => Promise<JsonRpcResponse>): Promise<void> {
    const resp = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agent-electron-app', version: '1.0.0' }
      }
    })
    if (resp.error) {
      throw new Error(`MCP initialize error: ${resp.error.message}`)
    }
    // Send initialized notification (no id)
    if (this.process && !this.process.killed) {
      this.process.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
    }
  }

  private async listTools(send: (req: JsonRpcRequest) => Promise<JsonRpcResponse>): Promise<McpToolDef[]> {
    const resp = await send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    })
    if (resp.error) {
      throw new Error(`tools/list error: ${resp.error.message}`)
    }
    const result = resp.result as { tools: McpToolDef[] }
    return result?.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const resp = await this.sendRpc({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args }
    })
    if (resp.error) {
      throw new Error(`tools/call error: ${resp.error.message}`)
    }
    return resp.result
  }

  disconnect(): void {
    if (this.process && !this.process.killed) {
      this.process.kill()
      this.process = null
    }
    for (const [, p] of this.pending) {
      p.reject(new Error('Connection closed'))
    }
    this.pending.clear()
  }
}

// ===== HTTP-based Connection (streamable-http + SSE) =====

class HttpConnection {
  private endpoint: string
  private nextId = 1
  private headers: Record<string, string>

  constructor(private config: McpServerConfig) {
    this.endpoint = ''
    this.headers = {}
  }

  async connect(): Promise<McpToolDef[]> {
    try {
      if (this.config.transport === 'sse') {
        this.endpoint = await this.resolveSseEndpoint()
      } else {
        this.endpoint = resolveEnv(this.config.url || '')
      }
      this.headers = { 'Content-Type': 'application/json', ...(this.config.headers || {}) }

      const send = (req: JsonRpcRequest) => this.sendRpc(req)
      await this.initialize(send)
      return this.listTools(send)
    } catch (err: any) {
      console.error(`[MCP HTTP/SSE] connect failed for ${this.config.server_id}:`, err)
      throw err
    }
  }

  private async resolveSseEndpoint(): Promise<string> {
    const url = resolveEnv(this.config.url || '')
    console.log(`[MCP SSE] Connecting to ${url}`)

    let response: Response
    try {
      response = await fetch(url, {
        headers: { Accept: 'text/event-stream', ...(this.config.headers || {}) }
      })
    } catch (err: any) {
      console.error(`[MCP SSE] fetch failed for ${url}:`, err)
      throw new Error(`SSE fetch failed: ${err.message || err}`)
    }

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`)
    }

    const body = response.body
    if (!body) throw new Error('SSE response has no body')

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let endpoint = ''
    let pendingEndpointEvent = false

    // Read SSE stream for up to 10 seconds to find endpoint
    const start = Date.now()
    while (Date.now() - start < 10000) {
      const timeoutPromise = new Promise<ReadableStreamReadResult<Uint8Array>>(
        (_, reject) => setTimeout(() => reject(new Error('SSE read timeout')), 1000)
      )
      const { done, value } = await Promise.race([reader.read(), timeoutPromise])
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          pendingEndpointEvent = false
          continue
        }

        if (trimmed === 'event: endpoint') {
          pendingEndpointEvent = true
          continue
        }

        if (pendingEndpointEvent && trimmed.startsWith('data: ')) {
          endpoint = trimmed.slice(6).trim()
          pendingEndpointEvent = false
        }
      }

      if (endpoint) break
    }

    try { await reader.cancel() } catch {}
    if (!endpoint) throw new Error('Failed to get SSE endpoint')
    console.log(`[MCP SSE] Got endpoint: ${endpoint}`)
    return endpoint
  }

  private async sendRpc(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(req)
    })

    if (!response.ok) {
      throw new Error(`MCP HTTP error: ${response.status}`)
    }

    const data = await response.json()
    return data as JsonRpcResponse
  }

  private async initialize(send: (req: JsonRpcRequest) => Promise<JsonRpcResponse>): Promise<void> {
    const resp = await send({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agent-electron-app', version: '1.0.0' }
      }
    })
    if (resp.error) {
      throw new Error(`MCP initialize error: ${resp.error.message}`)
    }
    // Send initialized notification
    await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })
    })
  }

  private async listTools(send: (req: JsonRpcRequest) => Promise<JsonRpcResponse>): Promise<McpToolDef[]> {
    const resp = await send({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/list',
      params: {}
    })
    if (resp.error) {
      throw new Error(`tools/list error: ${resp.error.message}`)
    }
    const result = resp.result as { tools: McpToolDef[] }
    return result?.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const resp = await this.sendRpc({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args }
    })
    if (resp.error) {
      throw new Error(`tools/call error: ${resp.error.message}`)
    }
    return resp.result
  }

  disconnect(): void {
    // No persistent connection to close for HTTP
  }
}

// ===== MCP Manager (singleton) =====

class McpManager {
  private connections = new Map<string, StdioConnection | HttpConnection>()

  async connect(serverId: string, config: McpServerConfig): Promise<McpToolDef[]> {
    // Disconnect existing connection if any
    this.disconnect(serverId)

    let conn: StdioConnection | HttpConnection
    if (config.transport === 'stdio') {
      conn = new StdioConnection(config)
    } else {
      conn = new HttpConnection(config)
    }

    this.connections.set(serverId, conn)
    return conn.connect()
  }

  async callTool(serverId: string, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const conn = this.connections.get(serverId)
    if (!conn) throw new Error(`MCP server ${serverId} is not connected`)
    return conn.callTool(toolName, input)
  }

  disconnect(serverId: string): void {
    const conn = this.connections.get(serverId)
    if (conn) {
      conn.disconnect()
      this.connections.delete(serverId)
    }
  }

  disconnectAll(): void {
    for (const [id] of this.connections) {
      this.disconnect(id)
    }
  }
}

export const mcpManager = new McpManager()
