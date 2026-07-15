import { cn } from '@/lib/utils'
import type { ToolUIPart } from 'ai'

import { CollapsibleBlock } from '../collapsible-block'
import { SubagentBlock, SubagentLabel, useSubagentInfo } from './subagent-block'

/** Renders one or more consecutive `task` calls as a list of sub-agents. */
export function SubagentGroupBlock({
  parts,
  messageId,
  toolErrors,
}: {
  parts: ToolUIPart[]
  messageId: string
  toolErrors?: string[]
}) {
  if (parts.length === 1) {
    return (
      <SubagentBlock
        part={parts[0]}
        messageId={messageId}
        forceError={toolErrors?.includes(parts[0].toolCallId)}
      />
    )
  }

  const label = (
    <>
      Launched{' '}
      <span className="text-foreground font-medium">
        {parts.length} sub-agents
      </span>
    </>
  )

  return (
    <CollapsibleBlock
      data-slot="subagent-group"
      collapsible={false}
      label={label}
    >
      <ul className="before:bg-border relative ml-4 flex flex-col gap-1 pb-2.5 pl-3 before:absolute before:top-0 before:left-0 before:h-2.5 before:w-px">
        {parts.map((part, index) => (
          <SubagentGroupItem
            key={part.toolCallId}
            part={part}
            last={index === parts.length - 1}
          />
        ))}
      </ul>
    </CollapsibleBlock>
  )
}

function SubagentGroupItem({
  part,
  last,
}: {
  part: ToolUIPart
  last: boolean
}) {
  const { input, childSessionId, live, status, openSession } =
    useSubagentInfo(part)

  const label = (
    <SubagentLabel
      name={live?.agent?.name ?? input?.agent_name}
      avatarId={live?.agent?.avatarId}
      title={input?.title}
      status={status}
      tokens={live?.tokens ?? null}
      linked={Boolean(childSessionId)}
    />
  )

  return (
    <li
      className={cn(
        'before:bg-border relative flex text-xs before:absolute before:top-2.5 before:-left-3 before:h-px before:w-2.5',
        !last &&
          'after:bg-border after:absolute after:top-2.5 after:-bottom-3.5 after:-left-3 after:w-px',
      )}
    >
      {openSession ? (
        <button
          type="button"
          onClick={openSession}
          className="group flex min-w-0 text-left"
        >
          {label}
        </button>
      ) : (
        label
      )}
    </li>
  )
}
