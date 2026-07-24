import type { Settings } from '../types'

function getAPI() {
  if (!window.electronAPI) {
    return {
      file: {
        glob: async () => [],
        read: async () => '',
        grep: async () => [],
        write: async () => {},
        edit: async () => {},
        exec: async () => ({ stdout: '', stderr: '', exit_code: 0 })
      },
      workspace: {
        select: async () => null
      },
      settings: {
        save: async () => {},
        load: async () => ({
          apiBaseUrl: '',
          apiKey: '',
          model: 'deepseek-v4-pro',
          workspacePath: '',
          fullAccess: false
        } as Settings)
      },
      mcp: {
        connect: async () => [],
        disconnect: async () => {},
        callTool: async () => { throw new Error('MCP not available') }
      }
    }
  }
  return window.electronAPI
}

export const ipcClient = getAPI()
