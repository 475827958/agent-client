import { useState, useEffect, useRef, useDeferredValue } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const CHARS_PER_TICK = 3
const TICK_MS = 33 // ~30fps for smooth animation without overloading React

interface Props {
  text: string
  isStreaming: boolean
  onDone?: () => void
}

export function TypewriterText({ text, isStreaming, onDone }: Props) {
  const [revealedLen, setRevealedLen] = useState(() => {
    // If not streaming (e.g. re-mount of a completed message), show all immediately
    if (!isStreaming) return text.length
    // If streaming but text already arrived, start from a reasonable point
    // to avoid re-animating the entire message
    return Math.max(0, Math.min(text.length, 200))
  })
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  // Animate character reveal during streaming
  useEffect(() => {
    if (!isStreaming) {
      setRevealedLen(text.length)
      return
    }

    timerRef.current = setInterval(() => {
      setRevealedLen((prev) => {
        if (prev >= text.length) {
          clearInterval(timerRef.current)
          return prev
        }
        return Math.min(prev + CHARS_PER_TICK, text.length)
      })
    }, TICK_MS)

    return () => clearInterval(timerRef.current)
  }, [text.length, isStreaming])

  // When streaming ends, immediately show all text
  useEffect(() => {
    if (!isStreaming) {
      setRevealedLen(text.length)
    }
  }, [isStreaming, text.length])

  // Notify parent when typewriter catches up to current text
  useEffect(() => {
    if (revealedLen >= text.length) {
      doneRef.current?.()
    }
  }, [revealedLen, text.length])

  const displayText = text.slice(0, revealedLen)
  // Defer expensive markdown rendering to keep animation smooth
  const deferredText = useDeferredValue(displayText)

  return (
    <div className="mt-1 mb-2 prose-sm max-w-none text-[#0f172a]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredText}</ReactMarkdown>
    </div>
  )
}
