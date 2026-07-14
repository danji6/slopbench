import { MarkdownRenderer } from '@/components/markdown'
import { Surface } from '@/components/ui'
import { getFontFamily, getMonoFontFamily } from '@/fonts'
import { cn } from '@/lib/utils'
import { type CSSProperties, useId } from 'react'

const PREVIEW_USER = `What does the quick brown fox do?`

const PREVIEW_AI = `It jumps over the lazy dog.
\`\`\`ts
function main() {
  return "Hello, World!"
}
\`\`\``

type MessagePreviewProps = {
  customCss?: string
  chatFont?: string
  monoFont?: string
  chatFontSize?: number
  className?: string
}

export function MessagePreview({
  customCss,
  chatFont,
  monoFont,
  chatFontSize,
  className,
}: MessagePreviewProps) {
  const scopeClass = `custom-css-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, '-')}`

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
      {customCss && (
        <style>{`@scope (.${scopeClass}) {\n${customCss}\n}`}</style>
      )}
      <Surface className="usr self-end">
        <MarkdownRenderer>{PREVIEW_USER}</MarkdownRenderer>
      </Surface>
      <div className="ai">
        <MarkdownRenderer>{PREVIEW_AI}</MarkdownRenderer>
      </div>
    </div>
  )
}
