import { useCodeAppearance } from '@/components/markdown/code-appearance'
import { CodeContainer, PlainCode } from '@/components/ui/code'
import { getCachedHighlight, highlight } from '@/lib/shiki/highlighter'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

export function StreamingCodeBlock({
  children,
  className,
  cursor,
}: {
  children?: React.ReactNode
  className?: string
  cursor?: boolean
}) {
  const appearance = useCodeAppearance()
  const language = /language-(\w+)/.exec(className || '')?.[1]
  const text = String(children ?? '').replace(/\n$/, '')
  const [highlighted, setHighlighted] = useState<{
    key: string
    html: string
  } | null>(null)

  // Read the cached highlight to minimize layout shifts
  const key = `${language ?? ''}\0${text}`
  const html = !appearance.highlighting
    ? null
    : highlighted?.key === key
      ? highlighted.html
      : getCachedHighlight(text, language)

  useEffect(() => {
    // Highlight only once the block is stable
    if (cursor || !appearance.highlighting) return
    if (getCachedHighlight(text, language)) return

    let mounted = true
    // Debounce Shiki
    const timeout = setTimeout(() => {
      highlight(text, language).then((res) => {
        if (mounted)
          setHighlighted({ key: `${language ?? ''}\0${text}`, html: res })
      })
    }, 100)

    return () => {
      mounted = false
      clearTimeout(timeout)
    }
  }, [text, language, cursor, appearance.highlighting])

  if (!html) {
    return (
      <CodeContainer
        hugParent
        copyValue={text}
        className={cn('mt-4 w-full', cursor && 'streaming-cursor-code')}
        lineNumbers={appearance.lineNumbers}
        wordWrap
      >
        <PlainCode text={text} />
      </CodeContainer>
    )
  }

  return (
    <CodeContainer
      hugParent
      dangerouslySetInnerHTML={{ __html: html }}
      copyValue={text}
      className={cn('mt-4 w-full', cursor && 'streaming-cursor-code')}
      lineNumbers={appearance.lineNumbers}
      wordWrap
    />
  )
}
