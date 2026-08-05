import { MarkdownRenderer } from '@/components/markdown'
import { Surface } from '@/components/ui'
import { getFontFamily, getMonoFontFamily } from '@/fonts'
import { useScopedAppearance } from '@/lib/chat'
import { cn } from '@/lib/utils'
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
  chatFont?: string
  monoFont?: string
  chatFontSize?: number
  className?: string
}

export function MessagePreview({
  baseCss,
  customCss,
  chatFont,
  monoFont,
  chatFontSize,
  className,
}: MessagePreviewProps) {
  const scopeClass = useScopedAppearance({ css: [baseCss, customCss] })

  return (
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
  )
}
