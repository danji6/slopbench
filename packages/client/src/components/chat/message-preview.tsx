import { MarkdownRenderer } from '@/components/markdown'
import { CodeAppearanceContext } from '@/components/markdown/code-appearance'
import { Surface } from '@/components/ui'
import { getFontFamily, getMonoFontFamily } from '@/fonts'
import { useScopedAppearance } from '@/lib/chat'
import { cn } from '@/lib/utils'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { CSSProperties } from 'react'

const PREVIEW_USER = `What does the quick brown fox do?`

const PREVIEW_AI = `It jumps over the lazy dog.
\`\`\`ts
function main() {
  return "Hello, World!"
}
\`\`\``

type MessagePreviewProps = {
  /** Css `customCss` layers over, for a preview of an agent's own rules. */
  baseCss?: string
  customCss?: string
  codeBlockHighlighting?: boolean
  codeBlockLineNumbers?: boolean
  chatFont?: string
  monoFont?: string
  chatFontSize?: number
  className?: string
}

export function MessagePreview({
  baseCss,
  customCss,
  codeBlockHighlighting = DEFAULT_SETTINGS.codeBlockHighlighting,
  codeBlockLineNumbers = DEFAULT_SETTINGS.codeBlockLineNumbers,
  chatFont,
  monoFont,
  chatFontSize,
  className,
}: MessagePreviewProps) {
  const scopeClass = useScopedAppearance({ css: [baseCss, customCss] })

  return (
    <CodeAppearanceContext.Provider
      value={{
        highlighting: codeBlockHighlighting,
        lineNumbers: codeBlockLineNumbers,
      }}
    >
      <div
        className={cn(
          scopeClass,
          'border-border bg-background flex w-full flex-col gap-4 rounded-lg border p-4',
          className,
        )}
        style={
          {
            ...(chatFont && { fontFamily: getFontFamily(chatFont) }),
            ...(chatFontSize && { fontSize: `${chatFontSize}px` }),
            ...(monoFont && { '--font-mono': getMonoFontFamily(monoFont) }),
          } as CSSProperties
        }
      >
        <Surface className="user self-end">
          <MarkdownRenderer>{PREVIEW_USER}</MarkdownRenderer>
        </Surface>
        <div className="ai">
          <MarkdownRenderer>{PREVIEW_AI}</MarkdownRenderer>
        </div>
      </div>
    </CodeAppearanceContext.Provider>
  )
}
