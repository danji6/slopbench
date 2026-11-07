import { useCode } from '@/hooks'

const COMMAND_CODE = 'shiki text-foreground whitespace-pre-wrap'

/** A shell command rendered inline with bash token colors. */
export function HighlightedCommand({ command }: { command: string }) {
  const code = useCode(command, 'shell')
  if (!code) return <span className={COMMAND_CODE}>{command}</span>

  // Shiki wraps the highlighted code in a tabbable pre for standalone blocks.
  const inlineCode = code.replace(/^<pre\b[^>]*>|<\/pre>$/g, '')
  return (
    <span
      className={COMMAND_CODE}
      dangerouslySetInnerHTML={{ __html: inlineCode }}
    />
  )
}
