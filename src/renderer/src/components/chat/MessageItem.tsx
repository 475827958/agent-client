import { Bot, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Message } from '../../types'
import { ToolCallCard } from './ToolCallCard'

interface Props {
  message: Message
}

export function MessageItem({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 px-4 py-4 ${isUser ? '' : 'bg-chat-bg/50'}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? 'bg-accent' : 'bg-sidebar-active'
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500 mb-1">
          {isUser ? '你' : 'Assistant'}
        </div>
        <div className="prose prose-invert prose-sm max-w-none text-gray-200">
          {message.content ? (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          ) : message.isStreaming ? (
            <span className="inline-block w-2 h-4 bg-accent animate-pulse" />
          ) : null}
        </div>
        {message.toolCalls?.map((tc) => (
          <ToolCallCard key={tc.id} toolCall={tc} />
        ))}
      </div>
    </div>
  )
}
