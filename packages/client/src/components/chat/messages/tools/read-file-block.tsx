import { getToolErrorText, getToolStatus } from '@/lib/chat'
import { cn } from '@/lib/utils'
import type { ToolUIPart } from 'ai'

import { CollapsibleBlock } from '../collapsible-block'
import { ToolIcon } from './tool-icon'
import { ToolList, ToolListItem } from './tool-list'

type ReadFileInput = {
  path?: string
  offset?: number
  limit?: number
}

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
      dense
      leadingIcon={<ToolIcon name="read_file" />}
      label={label}
    >
      <ToolList>
        {parts.map((part, index) => {
          const error = partError(part, toolErrors)
          const running = !error && partRunning(part, toolErrors)
          return (
            <ToolListItem
              key={part.toolCallId}
              last={index === parts.length - 1}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    'font-mono break-all',
                    running ? 'text-shimmer' : 'text-foreground',
                  )}
                >
                  {partPersonalPath(part) && 'Personal folder · '}
                  {partPath(part) ?? '…'}
                </span>
                {error && (
                  <span className="text-destructive wrap-break-word">
                    {error}
                  </span>
                )}
              </div>
            </ToolListItem>
          )
        })}
      </ToolList>
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

function partPersonalPath(part: ToolUIPart): boolean {
  const input = part.input as ReadFileInput | undefined
  return !!input?.path?.startsWith('agent://')
}
