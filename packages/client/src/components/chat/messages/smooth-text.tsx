import {
  KatexMath,
  MarkdownContext,
  MarkdownRenderer,
  matchMathClass,
} from '@/components/markdown'
import { CodeContainer, PlainCode } from '@/components/ui/code'
import { T } from '@/components/ui/typography'
import { useMathMode } from '@/hooks/chat/resolved-settings'
import { useStreamingCursor } from '@/hooks/chat/streaming-cursor'
import type { MathMode } from '@/lib/chat'
import { autoCloseMarkdown, splitAtLastBlock } from '@/lib/markdown/helpers'
import { remarkStreamingCursor } from '@/lib/markdown/remark'
import { getCachedHighlight, highlight } from '@/lib/shiki/highlighter'
import { cn } from '@/lib/utils'
import type { ReasoningUIPart, TextUIPart } from 'ai'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Components } from 'react-markdown'

type SmoothTextProps = {
  part: TextUIPart | ReasoningUIPart
}

function StreamingCodeBlock({
  children,
  className,
  cursor,
}: {
  children?: React.ReactNode
  className?: string
  cursor?: boolean
}) {
  const language = /language-(\w+)/.exec(className || '')?.[1]
  const text = String(children ?? '').replace(/\n$/, '')
  const [highlighted, setHighlighted] = useState<{
    key: string
    html: string
  } | null>(null)

  // Read the cached highlight to minimize layout shifts
  const key = `${language ?? ''}\0${text}`
  const html =
    highlighted?.key === key
      ? highlighted.html
      : getCachedHighlight(text, language)

  useEffect(() => {
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
  }, [text, language])

  if (!html) {
    return (
      <CodeContainer
        hugParent
        copyValue={text}
        className={cn('mt-4 w-full', cursor && 'streaming-cursor-code')}
        lineNumbers
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
      lineNumbers
      wordWrap
    />
  )
}

function StreamingCursor() {
  return <span aria-hidden="true" className="streaming-cursor" />
}

// We memoize what's already been rendered
const CommittedMarkdown = memo(function CommittedMarkdown({
  text,
  components,
  mathMode,
}: {
  text: string
  components: Components
  mathMode: MathMode
}) {
  return (
    <MarkdownRenderer components={components} enableBreaks mathMode={mathMode}>
      {text}
    </MarkdownRenderer>
  )
})

function SmoothTextComponent({ part }: SmoothTextProps) {
  const text = part.text
  const isStreaming = part.state === 'streaming'
  const streamingCursor = useStreamingCursor(text, isStreaming)
  const mathMode = useMathMode()

  const [smoothedText, setSmoothedText] = useState(text)
  const currentIndexRef = useRef(smoothedText.length)

  useEffect(() => {
    if (!isStreaming) return

    let rafId: number
    let lastTime = performance.now()

    // Resume from wherever we currently are painted
    currentIndexRef.current = smoothedText.length

    const loop = (time: number) => {
      rafId = requestAnimationFrame(loop)

      const dt = time - lastTime
      lastTime = time

      const BUFFER_CHARS = 8
      const targetLen = Math.max(0, text.length - BUFFER_CHARS)

      if (currentIndexRef.current >= targetLen) {
        return // Caught up
      }

      // Catch up speed: ~150ms
      const distance = targetLen - currentIndexRef.current
      let speed = distance / 0.15

      if (speed < 40) speed = 40

      currentIndexRef.current += (speed * dt) / 1000

      if (currentIndexRef.current >= targetLen) {
        currentIndexRef.current = targetLen
      }

      const nextInt = Math.floor(currentIndexRef.current)

      setSmoothedText((prev) => {
        if (nextInt <= prev.length) return prev

        // Back up past trailing markdown openers so we never leave the
        // display mid-construct (e.g. a lone `*` before `**bold**` arrives)
        let displayLen = nextInt
        while (displayLen > prev.length && /[*`]/.test(text[displayLen - 1])) {
          displayLen--
        }

        return displayLen > prev.length ? text.slice(0, displayLen) : prev
      })
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
    // We intentionally only restart the loop when new text chunks arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, isStreaming])

  const displayedText = isStreaming ? smoothedText : text

  const [committed, tail] = useMemo(
    () => (isStreaming ? splitAtLastBlock(displayedText) : [displayedText, '']),
    [displayedText, isStreaming],
  )

  // autoCloseMarkdown only runs on the small streaming tail, not the full text
  const tailMd = useMemo(
    () => (isStreaming && tail ? autoCloseMarkdown(tail, committed) : tail),
    [tail, committed, isStreaming],
  )

  const components = useMemo<Components>(
    () => ({
      h1: (props) => <T.h1 className="mt-6" {...props} />,
      h2: (props) => <T.h2 className="mt-4" {...props} />,
      h3: (props) => <T.h3 className="mt-4" {...props} />,
      h4: (props) => <T.h4 className="mt-4" {...props} />,
      pre({ children }) {
        return <>{children}</>
      },
      table({ children, className, ...props }) {
        return (
          <div className="mt-4 overflow-x-auto">
            <T.table className={cn('my-0', className)} {...props}>
              {children}
            </T.table>
          </div>
        )
      },
      img({ src, alt, className, ...props }) {
        return (
          // biome-ignore lint/performance/noImgElement: N/A
          <img
            src={src}
            alt={alt}
            className={cn('w-full object-contain', className)}
            {...props}
          />
        )
      },
      code({ node, className, children, ...props }) {
        const display = matchMathClass(className)
        if (display !== null) {
          return <KatexMath latex={String(children)} display={display} />
        }
        const match = /language-(\w+)/.exec(className || '')
        const nodeProps = node?.properties as
          Record<string, unknown> | undefined
        const cursor = nodeProps?.dataStreamingCursor === 'true'
        const isInline =
          !match &&
          !(node?.data as { hProperties?: { language?: string } })?.hProperties
            ?.language

        if (isInline && typeof children === 'string') {
          const isMultiline = children.includes('\n')
          if (!isMultiline) {
            return (
              <T.inlineCode className={className} {...props}>
                {children}
              </T.inlineCode>
            )
          }
        }

        return (
          <StreamingCodeBlock className={className} cursor={cursor}>
            {children}
          </StreamingCodeBlock>
        )
      },
      'md-streaming-cursor': StreamingCursor,
    }),
    [],
  )

  return (
    <MarkdownContext.Provider value={{ isViewer: true }}>
      <div className={streamingCursor}>
        {committed && (
          <CommittedMarkdown
            text={committed}
            components={components}
            mathMode={mathMode}
          />
        )}
        {tailMd && (
          <MarkdownRenderer
            components={components}
            enableBreaks
            mathMode={mathMode}
            remarkPlugins={[remarkStreamingCursor]}
          >
            {tailMd}
          </MarkdownRenderer>
        )}
      </div>
    </MarkdownContext.Provider>
  )
}

export type { SmoothTextProps }
export const SmoothText = memo(SmoothTextComponent)
