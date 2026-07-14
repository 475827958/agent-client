### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/renderer/index.html`

- [ ] **Step 1: Initialize package.json**

```bash
cd d:/MyProject/project_money/agent/agent-electron-app
```

Create `package.json`:

```json
{
  "name": "agent-desktop",
  "version": "1.0.0",
  "description": "Agent Desktop - AI-powered coding assistant",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-vite build && electron-builder --win"
  },
  "dependencies": {
    "electron-store": "^8.1.0",
    "zustand": "^4.5.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-markdown": "^9.0.1",
    "@monaco-editor/react": "^4.6.0",
    "lucide-react": "^0.312.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "class-variance-authority": "^0.7.0",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-switch": "^1.0.3",
    "@radix-ui/react-tooltip": "^1.0.7",
    "@radix-ui/react-scroll-area": "^1.0.5",
    "@radix-ui/react-tabs": "^1.0.4"
  },
  "devDependencies": {
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "electron": "^28.2.0",
    "electron-builder": "^24.9.1",
    "electron-vite": "^2.0.0",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

- [ ] **Step 3: Create electron.vite.config.ts**

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
```

- [ ] **Step 4: Create tsconfig files**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./out",
    "sourceMap": true,
    "target": "ESNext",
    "lib": ["ESNext"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "electron.vite.config.ts"]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./out",
    "sourceMap": true,
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/src/*"]
    }
  },
  "include": ["src/renderer/src/**/*"]
}
```

- [ ] **Step 5: Create Tailwind + PostCSS config**

`tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{ts,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#1e1e2e',
          hover: '#2a2a3e',
          active: '#363650',
          border: '#2e2e42'
        },
        chat: {
          bg: '#181825',
          bubble: {
            user: '#3b3b5c',
            assistant: '#1e1e2e'
          }
        },
        accent: {
          DEFAULT: '#7c7cf8',
          hover: '#6a6ae8'
        }
      }
    }
  },
  plugins: []
}
```

`postcss.config.js`:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
```

- [ ] **Step 6: Create renderer index.html**

`src/renderer/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Desktop</title>
  </head>
  <body class="bg-chat-bg text-gray-100 overflow-hidden">
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold electron-vite project with Tailwind and dependencies"
```

---

