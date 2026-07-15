import { getToolErrorText, getToolStatus } from '@/lib/chat'
import { cn } from '@/lib/utils'
import type { ToolUIPart } from 'ai'
import { FileTextIcon } from 'lucide-react'

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
  const label = (
    <>
      Read{' '}
      <span className="text-foreground font-medium">
        {parts.length} {parts.length === 1 ? 'file' : 'files'}
      </span>
    </>
  )

  return (
    <CollapsibleBlock
      data-slot="read-file-block"
      collapsible={false}
      leadingIcon={<FileTextIcon className="size-3.5 shrink-0" />}
      label={label}
    >
      <ul className="before:bg-border relative ml-4 flex flex-col gap-1 pb-2.5 pl-3 before:absolute before:top-0 before:left-0 before:h-2 before:w-px">
        {parts.map((part, index) => {
          const error = partError(part, toolErrors)
          const running = !error && partRunning(part, toolErrors)
          const last = index === parts.length - 1
          return (
            <li
              key={part.toolCallId}
              className={cn(
                'before:bg-border relative flex flex-wrap items-baseline gap-x-2 text-xs before:absolute before:top-2 before:-left-3 before:h-px before:w-2.5',
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
