import { cn } from '@/lib'
import { useEffect, useState } from 'react'

const IDLE_MS = 80

export function useStreamingCursor(text: string, isStreaming: boolean) {
  const [idleText, setIdleText] = useState<string | null>(null)

  useEffect(() => {
    if (!isStreaming) return

    const timeout = setTimeout(() => setIdleText(text), IDLE_MS)
    return () => clearTimeout(timeout)
  }, [text, isStreaming])

  return cn(
    isStreaming && 'streaming-cursor-root',
    isStreaming && idleText === text && 'streaming-cursor-idle',
  )
}
