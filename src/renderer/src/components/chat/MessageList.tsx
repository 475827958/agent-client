import { useRef, useEffect, useCallback } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { useModeStore } from '../../stores/modeStore'
import { MessageItem } from './MessageItem'

interface Props {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export function MessageList({ scrollContainerRef }: Props) {
  const task = useTaskStore((s) => s.getCurrentTask())
  const bottomRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevMsgCountRef = useRef(task?.messages.length ?? 0)
  const prevSegCountRef = useRef(0)

  const isStreaming = task?.messages.some((m) => m.isStreaming) ?? false

  // Track whether the user is at the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const threshold = 80
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [scrollContainerRef])

  // Attach scroll listener to the external scroll container
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [scrollContainerRef, handleScroll])

  // Auto-scroll to bottom on every content change while user is at the bottom
  // Uses ResizeObserver for efficient detection of content growth
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollContainerRef])

  // When a new message is added, force-scroll to bottom regardless of position
  useEffect(() => {
    const count = task?.messages.length ?? 0
    if (count > prevMsgCountRef.current) {
      isAtBottomRef.current = true
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      })
    }
    prevMsgCountRef.current = count
  }, [task?.messages.length])

  // When segments are added to messages (e.g. plan.question), force-scroll to bottom
  const totalSegs = task?.messages.reduce((sum, m) => sum + (m.segments?.length ?? 0), 0) ?? 0
  useEffect(() => {
    if (totalSegs > prevSegCountRef.current) {
      isAtBottomRef.current = true
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      })
    }
    prevSegCountRef.current = totalSegs
  }, [totalSegs])

  // When streaming starts, force-scroll to bottom
  useEffect(() => {
    if (isStreaming) {
      isAtBottomRef.current = true
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
  }, [isStreaming])

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
    <div className="flex flex-col gap-5">
      {task.messages.map((msg, idx) => (
        <MessageItem key={msg.id} message={msg} msgIndex={idx} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
