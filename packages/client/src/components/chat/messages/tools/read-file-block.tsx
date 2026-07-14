import { getToolErrorText, getToolStatus } from '@/lib/chat'
import { cn } from '@/lib/utils'
import type { ToolUIPart } from 'ai'

import { CollapsibleBlock } from '../collapsible-block'

type ReadFileInput = { path?: string; offset?: number; limit?: number }

/** Renders one or more consecutive read_file calls as a list. */
export function ReadFileBlock({
  parts,
  toolErrors,
}: {
  parts: ToolUIPart[]
  toolErrors?: string[]
}) {
  const grouped = parts.length > 1
  const label = !grouped ? (
    'Read'
  ) : (
    <>
      Read{' '}
      <span className="text-foreground font-medium">{parts.length} files</span>
    </>
  )

  return (
    <CollapsibleBlock
      data-slot="read-file-block"
      collapsible={false}
      label={label}
    >
      <ul
        className={cn(
          'flex flex-col gap-1 px-2.5 pb-2.5',
          grouped &&
            'before:bg-border relative ml-4 pl-3 before:absolute before:top-0 before:left-0 before:h-2 before:w-px',
        )}
      >
        {parts.map((part, index) => {
          const error = partError(part, toolErrors)
          const running = !error && partRunning(part, toolErrors)
          const last = index === parts.length - 1
          return (
            <li
              key={part.toolCallId}
              className={cn(
                'flex flex-wrap items-baseline gap-x-2 text-xs',
                grouped &&
                  'before:bg-border relative before:absolute before:top-2 before:-left-3 before:h-px before:w-2.5',
                grouped &&
                  !last &&
                  'after:bg-border after:absolute after:top-2 after:-bottom-3 after:-left-3 after:w-px',
              )}
            >
              <span
                className={cn(
                  'font-mono break-all',
                  running ? 'text-shimmer' : 'text-foreground',
                )}
              >
                {partPath(part) ?? '…'}
              </span>
              {error && (
                <span className="text-destructive wrap-break-word">
                  {error}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </CollapsibleBlock>
  )
}

function partPath(part: ToolUIPart): string | undefined {
  return (part.input as ReadFileInput | undefined)?.path
}

function partError(
  part: ToolUIPart,
  toolErrors?: string[],
): string | undefined {
  if (toolErrors?.includes(part.toolCallId)) {
    return getToolErrorText(part) ?? 'Failed to read file'
  }
  return getToolErrorText(part)
}

function partRunning(part: ToolUIPart, toolErrors?: string[]): boolean {
  if (toolErrors?.includes(part.toolCallId)) return false
  return getToolStatus(part) === 'running'
}
