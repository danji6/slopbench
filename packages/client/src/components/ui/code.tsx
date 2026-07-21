import { useCode, useDebouncedState } from '@/hooks'
import { diffVisualText } from '@/lib/shiki/diff'
import { cn } from '@/lib/utils'
import { Fragment, useEffect } from 'react'

import { CopyButton } from './copy-button'
import { LoadingIndicator } from './loading-indicator'
import { Surface } from './surface'

export type CodeProps = CodeContainerProps & {
  text?: string
  language?: string
  delay?: number
  noCopyButton?: boolean
  noLoadingIndicator?: boolean
  /** Render `text` as a unified diff with green/red line backgrounds. */
  diff?: boolean
}

export type CodeContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  innerClassName?: string
  innerStyle?: React.CSSProperties
  copyValue?: string
  lineNumberValue?: string
  hugParent?: boolean
  wordWrap?: boolean
  lineNumbers?: boolean
}

export function Code({
  text,
  language = 'typescript',
  delay = 0,
  noCopyButton = false,
  noLoadingIndicator = false,
  diff = false,
  ...props
}: CodeProps) {
  const [debouncedText, setDebouncedText] = useDebouncedState(text, delay)
  const code = useCode(debouncedText, language, diff)

  useEffect(() => {
    setDebouncedText(text)
  }, [text, setDebouncedText])

  if (!code) {
    return (
      <CodePlaceholder
        text={diff && text ? diffVisualText(text) : text}
        noLoadingIndicator={noLoadingIndicator}
        {...props}
      />
    )
  }

  return (
    <CodeContainer
      dangerouslySetInnerHTML={{ __html: code }}
      copyValue={noCopyButton ? undefined : text}
      lineNumberValue={text}
      {...props}
    />
  )
}

export function CodeContainer({
  children,
  className,
  innerClassName,
  innerStyle,
  copyValue,
  lineNumberValue,
  dangerouslySetInnerHTML,
  hugParent = false,
  wordWrap = false,
  lineNumbers = false,
  ...props
}: CodeContainerProps) {
  const lineNumberSource = lineNumberValue ?? copyValue
  const lineNumberDigits =
    lineNumbers && lineNumberSource
      ? Math.max(2, String(lineNumberSource.split('\n').length).length)
      : undefined

  const codeSurfaceStyle = lineNumberDigits
    ? ({
        '--line-number-digits': lineNumberDigits,
        ...innerStyle,
      } as React.CSSProperties)
    : innerStyle

  const surfaceClassName = cn(
    copyValue && 'col-start-1 row-start-1 pr-12',
    wordWrap &&
      'overflow-x-hidden wrap-anywhere whitespace-pre-wrap [&_.line]:wrap-anywhere [&_code]:wrap-anywhere [&_code]:whitespace-pre-wrap [&_pre]:wrap-anywhere [&_pre]:whitespace-pre-wrap',
    lineNumbers && 'shiki-numbered',
    innerClassName,
  )

  // Prettier removes this...
  const newline = '\n'

  return (
    <div
      data-slot="code-container"
      className={cn(
        'group/code relative isolate grid min-h-17 items-center overflow-clip rounded-2xl',
        !hugParent && 'max-w-[calc(100%-var(--spacing)*5)]',
        className,
      )}
      {...props}
    >
      {dangerouslySetInnerHTML ? (
        <CodeSurface
          // biome-ignore lint/security/noDangerouslySetInnerHtml: needed for Shiki to work
          dangerouslySetInnerHTML={dangerouslySetInnerHTML}
          className={surfaceClassName}
          style={codeSurfaceStyle}
        />
      ) : (
        <CodeSurface className={surfaceClassName} style={codeSurfaceStyle}>
          {children}
        </CodeSurface>
      )}
      {copyValue && (
        <div
          className={cn(
            'pointer-events-none z-10 col-start-1 row-start-1 flex justify-end self-stretch',
            copyValue.includes(newline) ? 'items-start' : 'items-center',
          )}
        >
          <CopyButton
            value={copyValue}
            className={cn(
              'bg-m3-surface-container/90 pointer-events-auto mr-2 opacity-0 backdrop-blur-sm group-hover/code:opacity-100 [@media(hover:none)]:opacity-100',
              copyValue.includes(newline) && 'sticky top-2 mt-2',
            )}
            tooltipSide="left"
          />
        </div>
      )}
    </div>
  )
}

/**
 * Renders raw code using the same `.shiki`/`.line` structure Shiki emits.
 * This allows pre-highlighted code to render exactly the same.
 */
export function PlainCode({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <pre className="shiki">
      <code>
        {lines.map((line, index) => (
          <Fragment key={index}>
            <span className="line">{line}</span>
            {index < lines.length - 1 ? '\n' : null}
          </Fragment>
        ))}
      </code>
    </pre>
  )
}

function CodeSurface({
  className,
  ...props
}: { className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Surface
      data-slot="code-surface"
      className={cn(
        'w-full min-w-0 overflow-auto p-4 text-sm outline-none focus:outline-none focus-visible:outline-none [&>pre]:bg-transparent [&>pre]:outline-none',
        className,
      )}
      {...props}
    />
  )
}

function CodePlaceholder({
  text,
  className,
  noLoadingIndicator = false,
  hugParent = false,
  wordWrap = false,
  lineNumbers = false,
  innerClassName,
}: {
  text?: string
  className?: string
  noLoadingIndicator?: boolean
  hugParent?: boolean
  wordWrap?: boolean
  lineNumbers?: boolean
  innerClassName?: string
  innerStyle?: React.CSSProperties
}) {
  const heightClass = innerClassName
    ?.split(' ')
    .find((c) => /^(max-)?h-\d+$/.test(c))

  const heightValue = heightClass?.replace(/(h|max-h)-/, '')
  const heightProp = heightClass?.startsWith('max-h-') ? 'maxHeight' : 'height'

  return (
    <CodeContainer
      className={className}
      innerClassName={cn(
        !noLoadingIndicator && 'flex items-center justify-center p-8',
        innerClassName,
      )}
      innerStyle={
        heightValue
          ? {
              [heightProp]: `calc(var(--spacing) * ${heightValue})`,
            }
          : undefined
      }
      hugParent={hugParent}
      wordWrap={wordWrap}
      lineNumbers={lineNumbers}
      lineNumberValue={text}
    >
      {noLoadingIndicator ? <pre>{text}</pre> : <LoadingIndicator />}
    </CodeContainer>
  )
}
