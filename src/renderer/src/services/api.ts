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
