import { isToolInFlight } from '@/lib/chat'
import type { ToolUIPart } from 'ai'

import { CollapsibleBlock } from '../collapsible-block'
import { FileChangeBlock } from './file-change-block'
import { ToolIcon } from './tool-icon'
import { ToolList, ToolListItem } from './tool-list'

type FileChangeGroupBlockProps = {
  parts: ToolUIPart[]
  messageId: string
  toolErrors?: string[]
}

/** Lists consecutive writes and edits with independently expandable diffs. */
export function FileChangeGroupBlock({
  parts,
  messageId,
  toolErrors,
}: FileChangeGroupBlockProps) {
  const running = parts.some(isToolInFlight)
  const verb = changeVerb(parts, running)

  return (
    <CollapsibleBlock
      data-slot="file-change-group"
      collapsible={false}
      dense
      fullWidth
      leadingIcon={<ToolIcon name="edit_file" />}
      label={
        <>
          {verb}{' '}
          <span className="text-foreground font-medium">
            {parts.length} {parts.length === 1 ? 'file' : 'files'}
          </span>
        </>
      }
    >
      <ToolList>
        {parts.map((part, index) => (
          <ToolListItem key={part.toolCallId} last={index === parts.length - 1}>
            <FileChangeBlock
              part={part}
              messageId={messageId}
              forceError={toolErrors?.includes(part.toolCallId)}
              grouped
            />
          </ToolListItem>
        ))}
      </ToolList>
    </CollapsibleBlock>
  )
}

function changeVerb(parts: ToolUIPart[], running: boolean): string {
  if (parts.every((part) => part.type === 'tool-write_file')) {
    return running ? 'Writing' : 'Wrote'
  }
  if (parts.every((part) => part.type === 'tool-edit_file')) {
    return running ? 'Editing' : 'Edited'
  }
  return running ? 'Changing' : 'Changed'
}
