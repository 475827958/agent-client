import { contextBridge, ipcRenderer } from 'electron'

const api = {
  file: {
    glob: (pattern: string) => ipcRenderer.invoke('file:glob', pattern),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    grep: (pattern: string, dirPath: string) => ipcRenderer.invoke('file:grep', pattern, dirPath),
    write: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
    edit: (path: string, oldStr: string, newStr: string) =>
      ipcRenderer.invoke('file:edit', path, oldStr, newStr),
    exec: (command: string, timeoutMs?: number) =>
      ipcRenderer.invoke('file:exec', command, timeoutMs)
  },
  workspace: {
    select: () => ipcRenderer.invoke('workspace:select')
  },
  settings: {
    save: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
    load: () => ipcRenderer.invoke('settings:load')
  },
  mcp: {
    connect: (serverId: string, config: unknown) => ipcRenderer.invoke('mcp:connect', serverId, config),
    disconnect: (serverId: string) => ipcRenderer.invoke('mcp:disconnect', serverId),
    callTool: (serverId: string, toolName: string, input: unknown) =>
      ipcRenderer.invoke('mcp:call-tool', serverId, toolName, input)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
