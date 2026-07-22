import { useState, useEffect, useRef, useDeferredValue } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const TICK_MS = 50 // ~20fps, smooth but less overhead than 33ms

interface Props {
  text: string
  isStreaming: boolean
  onDone?: () => void
}

export function TypewriterText({ text, isStreaming, onDone }: Props) {
  const [revealedLen, setRevealedLen] = useState(() => {
    if (!isStreaming) return text.length
    return Math.max(0, Math.min(text.length, 200))
  })
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    if (!isStreaming) {
      setRevealedLen(text.length)
      return
    }

    timerRef.current = setInterval(() => {
      setRevealedLen((prev) => {
        if (prev >= text.length) return prev
        // Reveal one full line per tick — jump to the next newline
        const nextNL = text.indexOf('\n', prev)
        if (nextNL >= 0) return nextNL + 1
        // Incomplete last line: reveal it all
        return text.length
      })
    }, TICK_MS)

    return () => clearInterval(timerRef.current)
  }, [text.length, isStreaming])

  useEffect(() => {
    if (!isStreaming) {
      setRevealedLen(text.length)
    }
  }, [isStreaming, text.length])

  useEffect(() => {
    if (revealedLen >= text.length) {
      doneRef.current?.()
    }
  }, [revealedLen, text.length])

  const displayText = text.slice(0, revealedLen)
  const deferredText = useDeferredValue(displayText)

  return (
    <div className="mt-1 mb-2 prose-sm max-w-none text-[#0f172a]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredText}</ReactMarkdown>
    </div>
  )
}
