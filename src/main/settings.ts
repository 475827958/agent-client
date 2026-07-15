import { ipcMain } from 'electron'
import Store from 'electron-store'

interface StoredSettings {
  apiBaseUrl: string
  apiKey: string
  model: string
  workspacePath: string
  fullAccess: boolean
}

const defaults: StoredSettings = {
  apiBaseUrl: '',
  apiKey: '',
  model: 'deepseek-v4-pro',
  workspacePath: '/projects/data-report',
  fullAccess: false
}

export function registerSettings(): { store: Store<StoredSettings>; get: () => StoredSettings } {
  const store = new Store<StoredSettings>({ defaults })

  ipcMain.handle('settings:save', async (_event, settings: StoredSettings) => {
    store.set(settings)
  })

  ipcMain.handle('settings:load', async () => {
    return store.store
  })

  return {
    store,
    get: () => store.store
  }
}
