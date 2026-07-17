import { useCallback } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { useChatStore } from '../../stores/chatStore'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'

export function ChatPanel() {
  const task = useTaskStore((s) => s.getCurrentTask())
  const isProcessing = useChatStore((s) => s.isProcessing)
  const hasMessages = task && task.messages && task.messages.length > 0

  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${hasMessages ? '' : 'justify-center'}`}>
      {hasMessages && (
        <div className="flex-shrink-0 flex items-center px-5 py-3 gap-2 border-b border-[#e2e8f0] bg-white rounded-t-[14px]">
          <span className="text-[13px] font-medium text-[#0f172a] truncate flex-1">
            {task?.title || 'iWork'}
          </span>
          {isProcessing && (
            <span className="text-[11px] text-[#f59e0b] font-medium flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
              处理中...
            </span>
          )}
        </div>
      )}

      {/* Messages — scrollbar at full width, content constrained */}
      <div className={`flex flex-col flex-1 min-h-0 overflow-y-auto ${hasMessages ? '' : 'justify-center'}`}>
        <div className={`flex flex-col ${hasMessages ? 'flex-1 min-h-0' : ''} max-w-[768px] w-full mx-auto px-6 gap-4`}>
          <MessageList />
        </div>
      </div>

      <ChatInput />
    </div>
  )
}
