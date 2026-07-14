import { useConversationStore } from '../../stores/conversationStore'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'

export function ChatPanel() {
  const conv = useConversationStore((s) => s.getCurrentConversation())

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 px-4 py-3 border-b border-sidebar-border">
        <h2 className="text-sm font-medium text-gray-300 truncate">
          {conv?.title || 'Agent Desktop'}
        </h2>
      </div>
      <MessageList />
      <ChatInput />
    </div>
  )
}
