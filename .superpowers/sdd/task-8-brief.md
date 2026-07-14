### Task 8: SSE & API Services

**Files:**
- Create: `src/renderer/src/services/sse.ts`
- Create: `src/renderer/src/services/api.ts`

**Interfaces:**
- Consumes: Settings from Task 5
- Produces: `parseSSEStream` generator, `sendChatMessage` function

- [ ] **Step 1: Create SSE parser**

`src/renderer/src/services/sse.ts`:

```typescript
export interface SSEDelta {
  content?: string
  tool_calls?: Array<{
    index: number
    id?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

export interface SSEChunk {
  content: string
  toolCalls: Map<number, {
    id: string
    name: string
    arguments: string
    complete: boolean
  }>
  done: boolean
}

export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<SSEChunk> {
  const decoder = new TextDecoder()
  let buffer = ''
  const accumulatingToolCalls = new Map<number, {
    id: string
    name: string
    arguments: string
    complete: boolean
  }>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        yield { content: '', toolCalls: accumulatingToolCalls, done: true }
        return
      }

      try {
        const parsed = JSON.parse(data)
        const choice = parsed.choices?.[0]
        if (!choice) continue

        const delta: SSEDelta = choice.delta || {}
        let content = ''

        if (delta.content) {
          content = delta.content
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = accumulatingToolCalls.get(tc.index) || {
              id: tc.id || '',
              name: '',
              arguments: '',
              complete: false
            }
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
            if (tc.function?.arguments) existing.arguments += tc.function.arguments
            accumulatingToolCalls.set(tc.index, existing)
          }
        }

        yield { content, toolCalls: accumulatingToolCalls, done: false }
      } catch {
        // skip malformed JSON lines
      }
    }
  }
}
```

- [ ] **Step 2: Create API service**

`src/renderer/src/services/api.ts`:

```typescript
import type { Message } from '../types'
import { useSettingsStore } from '../stores/settingsStore'
import { parseSSEStream } from './sse'
import type { SSEChunk } from './sse'

export async function sendChatMessage(
  messages: Message[],
  onChunk: (chunk: SSEChunk) => void,
  onError: (err: Error) => void,
  onDone: () => void
): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const url = `${settings.apiBaseUrl}/v1/chat/completions`

  const apiMessages = messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: apiMessages,
        stream: true
      })
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Response body is not readable')

    for await (const chunk of parseSSEStream(reader)) {
      if (chunk.done) {
        onDone()
        return
      }
      onChunk(chunk)
    }

    onDone()
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/sse.ts src/renderer/src/services/api.ts
git commit -m "feat: add SSE parser and chat API service"
```

---

