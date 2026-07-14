### Task 6: Conversation Store

**Files:**
- Create: `src/renderer/src/stores/conversationStore.ts`

**Interfaces:**
- Produces: `useConversationStore` with `create`, `delete`, `select`, `updateTitle`, `addMessage`, `getCurrentConversation`

- [ ] **Step 1: Create conversation store**

`src/renderer/src/stores/conversationStore.ts`:

```typescript
import { create } from 'zustand'
import type { Conversation, Message } from '../types'

let nextId = 1
function genId(): string {
  return `conv_${Date.now()}_${nextId++}`
}
function msgGenId(): string {
  return `msg_${Date.now()}_${nextId++}`
}

interface ConversationState {
  conversations: Conversation[]
  currentConversationId: string | null

  create: () => string
  delete: (id: string) => void
  select: (id: string) => void
  updateTitle: (id: string, title: string) => void
  addMessage: (message: Message) => void
  updateLastAssistantMessage: (updater: (msg: Message) => Message) => void
  getCurrentConversation: () => Conversation | undefined
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  currentConversationId: null,

  create: () => {
    const id = genId()
    const conv: Conversation = {
      id,
      title: '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    }
    set((s) => ({
      conversations: [conv, ...s.conversations],
      currentConversationId: id
    }))
    return id
  },

  delete: (id: string) => {
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== id)
      const currentId =
        s.currentConversationId === id
          ? filtered[0]?.id ?? null
          : s.currentConversationId
      return { conversations: filtered, currentConversationId: currentId }
    })
  },

  select: (id: string) => set({ currentConversationId: id }),

  updateTitle: (id: string, title: string) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      )
    }))
  },

  addMessage: (message: Message) => {
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id === s.currentConversationId) {
          // Auto-title from first user message
          const title =
            c.title === '新对话' && message.role === 'user'
              ? message.content.slice(0, 40)
              : c.title
          return {
            ...c,
            title,
            updatedAt: Date.now(),
            messages: [...c.messages, message]
          }
        }
        return c
      })
    }))
  },

  updateLastAssistantMessage: (updater: (msg: Message) => Message) => {
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== s.currentConversationId) return c
        const messages = [...c.messages]
        const lastIdx = messages.length - 1
        if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = updater(messages[lastIdx])
        }
        return { ...c, messages, updatedAt: Date.now() }
      })
    }))
  },

  getCurrentConversation: () => {
    const state = get()
    return state.conversations.find((c) => c.id === state.currentConversationId)
  }
}))
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/stores/conversationStore.ts
git commit -m "feat: add conversation store with multi-session support"
```

---

