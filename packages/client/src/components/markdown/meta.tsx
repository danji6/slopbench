
import { useEffect } from 'react'

import { useMarkdown } from './context'

export function MarkdownMeta({ content }: { content: string }) {
  const { setThemeColor } = useMarkdown()

  useEffect(() => {
    const match = content.match(/#?([a-f0-9]{6})/i)
    setThemeColor?.(match ? `#${match[1]}` : undefined)

    return () => {
      setThemeColor?.(undefined)
    }
  }, [content, setThemeColor])

  return null
}
