### Task 4: Preload Script

**Files:**
- Create: `src/preload/index.ts`

**Interfaces:**
- Produces: `window.electronAPI` with `file`, `workspace`, `settings` namespaces

- [ ] **Step 1: Create preload script**

`src/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  file: {
    glob: (pattern: string) => ipcRenderer.invoke('file:glob', pattern),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    grep: (pattern: string, dirPath: string) => ipcRenderer.invoke('file:grep', pattern, dirPath),
    write: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
    edit: (path: string, oldStr: string, newStr: string) =>
      ipcRenderer.invoke('file:edit', path, oldStr, newStr)
  },
  workspace: {
    select: () => ipcRenderer.invoke('workspace:select')
  },
  settings: {
    save: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
    load: () => ipcRenderer.invoke('settings:load')
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: add preload script with contextBridge API"
```

---

