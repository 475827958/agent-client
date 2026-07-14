import type { Settings } from '../types'

function getAPI() {
  if (!window.electronAPI) {
    // Return mock for dev in browser (non-Electron context)
    return {
      file: {
        glob: async () => [],
        read: async () => '',
        grep: async () => [],
        write: async () => {},
        edit: async () => {}
      },
      workspace: {
        select: async () => null
      },
      settings: {
        save: async () => {},
        load: async () => ({
          apiBaseUrl: 'http://localhost:8080',
          apiKey: '',
          model: 'gpt-4',
          workspacePath: '',
          fullAccess: false
        })
      }
    }
  }
  return window.electronAPI
}

export const ipcClient = getAPI()
