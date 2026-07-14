import { useEffect, useRef } from 'react'
import { useConversationStore } from '../../stores/conversationStore'
import { MessageItem } from './MessageItem'

export function MessageList() {
  const conv = useConversationStore((s) => s.getCurrentConversation())
  const messages = conv?.messages || []
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-3">🤖</div>
          <div className="text-sm">开始一段新对话</div>
          <div className="text-xs mt-1 text-gray-600">
            输入 / 使用指令，或直接提问
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
