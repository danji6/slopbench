import { useCode } from '@/hooks'

// Fallback while Shiki resolves asynchronously to keep it stable
const COMMAND_CODE =
  'text-foreground whitespace-pre-wrap [&_.line]:inline [&_code]:inline [&>pre]:m-0! [&>pre]:inline [&>pre]:bg-transparent! [&>pre]:p-0! [&>pre]:whitespace-pre-wrap [&>pre]:outline-none'

/** A shell command rendered inline with bash token colors. */
export function HighlightedCommand({ command }: { command: string }) {
  const code = useCode(command, 'shell')
  if (!code) return <span className={COMMAND_CODE}>{command}</span>
  return (
    <span className={COMMAND_CODE} dangerouslySetInnerHTML={{ __html: code }} />
  )
}
