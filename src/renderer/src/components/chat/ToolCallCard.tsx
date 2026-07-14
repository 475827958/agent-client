import { Wrench, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react'
import type { ToolCall } from '../../types'
import { useChatStore } from '../../stores/chatStore'

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Loader2 size={14} className="animate-spin text-gray-400" />,
  confirming: <AlertCircle size={14} className="text-yellow-400" />,
  executing: <Loader2 size={14} className="animate-spin text-blue-400" />,
  done: <CheckCircle size={14} className="text-green-400" />,
  error: <XCircle size={14} className="text-red-400" />
}

const STATUS_LABEL: Record<string, string> = {
  pending: '执行中...',
  confirming: '等待确认',
  executing: '执行中...',
  done: '完成',
  error: '失败'
}

interface Props {
  toolCall: ToolCall
}

export function ToolCallCard({ toolCall }: Props) {
  const confirm = useChatStore((s) => s.confirmToolCall)
  const cancel = useChatStore((s) => s.cancelToolCall)

  return (
    <div className="my-2 p-3 rounded-lg bg-sidebar-bg border border-sidebar-border">
      <div className="flex items-center gap-2 mb-2">
        <Wrench size={14} className="text-accent" />
        <span className="text-sm font-medium text-gray-300">
          {toolCall.name || toolCall.type}
        </span>
        <span className="flex items-center gap-1 text-xs">
          {STATUS_ICON[toolCall.status]}
          <span className="text-gray-500">{STATUS_LABEL[toolCall.status]}</span>
        </span>
      </div>

      <div className="text-xs text-gray-500 font-mono bg-chat-bg rounded p-2 mb-2 overflow-x-auto">
        {formatArgs(toolCall.args)}
      </div>

      {toolCall.status === 'confirming' && (
        <div className="flex gap-2">
          <button
            onClick={() => confirm(toolCall.id)}
            className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            是，执行
          </button>
          <button
            onClick={() => cancel(toolCall.id)}
            className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            否，取消
          </button>
        </div>
      )}

      {toolCall.result && (
        <div className="text-xs text-gray-400 font-mono bg-chat-bg rounded p-2 mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {toolCall.result}
        </div>
      )}
    </div>
  )
}

function formatArgs(args: Record<string, string>): string {
  const { _raw, ...rest } = args
  if (_raw) return _raw
  return JSON.stringify(rest, null, 0)
}
