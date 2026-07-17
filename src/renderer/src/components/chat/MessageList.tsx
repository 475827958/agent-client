import { useRef, useEffect } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { useChatStore } from '../../stores/chatStore'
import { useModeStore } from '../../stores/modeStore'
import { MessageItem } from './MessageItem'

export function MessageList() {
  const task = useTaskStore((s) => s.getCurrentTask())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [task?.messages.length])

  const sceneMode = useModeStore((s) => s.sceneMode)
  const setSceneMode = useModeStore((s) => s.setSceneMode)

  if (!task || !task.messages || task.messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-[14px] bg-[#a7f3d0] text-white flex items-center justify-center text-[32px] font-bold">✓</div>
          <h2 className="text-[22px] font-semibold text-[#0f172a] tracking-[-0.4px]">iWork，您的AI工作助手</h2>
          <div className="flex gap-2 flex-wrap justify-center">
            <button
              onClick={() => setSceneMode('office')}
              className={`px-4 py-1.5 rounded-[20px] text-[13px] font-medium transition-colors border cursor-pointer ${
                sceneMode === 'office'
                  ? 'bg-[#0f172a] text-white border-[#0f172a]'
                  : 'bg-white text-[#64748b] border-[#e2e8f0] hover:border-[#a7f3d0] hover:text-[#a7f3d0] hover:bg-[#f0fdf4]'
              }`}
            >
              日常办公
            </button>
            <button
              onClick={() => setSceneMode('code')}
              className={`px-4 py-1.5 rounded-[20px] text-[13px] font-medium transition-colors border cursor-pointer ${
                sceneMode === 'code'
                  ? 'bg-[#0f172a] text-white border-[#0f172a]'
                  : 'bg-white text-[#64748b] border-[#e2e8f0] hover:border-[#a7f3d0] hover:text-[#a7f3d0] hover:bg-[#f0fdf4]'
              }`}
            >
              代码开发
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col gap-5 scroll-smooth min-h-0">
      {task.messages.map((msg, idx) => (
        <MessageItem key={msg.id} message={msg} msgIndex={idx} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
