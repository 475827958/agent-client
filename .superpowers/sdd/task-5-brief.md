### Task 5: IPC Client & Settings Store

**Files:**
- Create: `src/renderer/src/services/ipcClient.ts`
- Create: `src/renderer/src/stores/settingsStore.ts`

**Interfaces:**
- Consumes: `ElectronAPI` from Task 2, preload from Task 4
- Produces: `ipcClient` service, `useSettingsStore` Zustand store

- [ ] **Step 1: Create IPC client service**

`src/renderer/src/services/ipcClient.ts`:

```typescript
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
```

- [ ] **Step 2: Create settings store**

`src/renderer/src/stores/settingsStore.ts`:

```typescript
import { create } from 'zustand'
import type { Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { ipcClient } from '../services/ipcClient'

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  load: () => Promise<void>
  save: (settings: Partial<Settings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  load: async () => {
    try {
      const saved = await ipcClient.settings.load()
      set({ settings: { ...DEFAULT_SETTINGS, ...saved }, isLoaded: true })
    } catch {
      set({ isLoaded: true })
    }
  },

  save: async (partial: Partial<Settings>) => {
    const updated = { ...get().settings, ...partial }
    set({ settings: updated })
    await ipcClient.settings.save(updated)
  }
}))
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/ipcClient.ts src/renderer/src/stores/settingsStore.ts
git commit -m "feat: add IPC client and settings store"
```

---

