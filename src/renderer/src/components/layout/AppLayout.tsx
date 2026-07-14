import { useState, useCallback } from 'react'
import { Sidebar } from '../sidebar/Sidebar'
import { ChatPanel } from '../chat/ChatPanel'

export function AppLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [dragging, setDragging] = useState(false)

  const handleMouseDown = useCallback(() => {
    setDragging(true)
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return
      const newWidth = Math.max(240, Math.min(500, e.clientX))
      setSidebarWidth(newWidth)
    },
    [dragging]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  return (
    <div
      className="flex h-screen select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div style={{ width: sidebarWidth }} className="flex-shrink-0">
        <Sidebar />
      </div>
      <div
        className="w-1 cursor-col-resize hover:bg-accent bg-transparent transition-colors flex-shrink-0"
        onMouseDown={handleMouseDown}
      />
      <div className="flex-1 min-w-0">
        <ChatPanel />
      </div>
    </div>
  )
}
