import type { PartMetadata, UIMessageType } from '@/lib/chat'
import type {
  FileLinkPart,
  PartGroup,
  PlanLinkPart,
  SubagentReportPart,
} from '@/lib/chat/parts'
import {
  isFileLinkPart,
  isPlanLinkPart,
  isSubagentReportPart,
} from '@/lib/chat/parts'
import {
  type UIMessage,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
} from 'ai'
import { memo } from 'react'

import { FileBlock } from './file-block'
import { FileLinkBlock } from './file-link-block'
import { PlanLinkBlock } from './plan-link-block'
import { ReasoningBlock } from './reasoning-block'
import { SubagentReportBlock } from '../subagents/subagent-report-block'
import { SummaryBlock } from './summary-block'
import { TextBlock } from './text-block'
import { ReadFileBlock } from './tools/read-file-block'
import { ShellGroupBlock } from './tools/shell-group-block'
import { ToolPartBlock } from './tools/tool-part-block'

export type RenderGroupProps = {
  message: UIMessage
  group: PartGroup
  /** The segment holding this group (part indices are intra-segment). */
  segmentIndex?: number
  type?: UIMessageType
  attachmentIds?: Record<string, string>
  partMeta?: PartMetadata
}

export const RenderGroup = memo(function RenderGroup(props: RenderGroupProps) {
  const { group, attachmentIds, partMeta } = props

  if (group.type === 'files') {
    return <FileBlock parts={group.parts} attachmentIds={attachmentIds} />
  }

  if (group.type === 'tools') {
    if (group.toolName === 'shell') {
      return (
        <ShellGroupBlock
          parts={group.parts}
          messageId={props.message.id}
          toolErrors={partMeta?.toolErrors}
        />
      )
    }
    return (
      <ReadFileBlock parts={group.parts} toolErrors={partMeta?.toolErrors} />
    )
  }

  const { part } = group

  if (isFileLinkPart(part)) {
    return <FileLinkBlock path={(part as FileLinkPart).path} />
  }

  if (isPlanLinkPart(part)) {
    return <PlanLinkBlock status={(part as PlanLinkPart).snapshot.status} />
  }

  if (isSubagentReportPart(part)) {
    return <SubagentReportBlock part={part as SubagentReportPart} />
  }

  if (isReasoningUIPart(part)) {
    return <ReasoningBlock part={part} />
  }

  if (isToolUIPart(part) && part.type !== 'dynamic-tool') {
    const forceError = Boolean(partMeta?.toolErrors?.includes(part.toolCallId))
    return (
      <ToolPartBlock
        part={part}
        messageId={props.message.id}
        forceError={forceError}
      />
    )
  }

  const { message, type } = props

  if (isTextUIPart(part)) {
    switch (type) {
      case 'summary':
        return <SummaryBlock message={message} />
      default:
        return (
          <TextBlock
            part={part}
            segmentIndex={props.segmentIndex ?? 0}
            index={group.index}
          />
        )
    }
  }

  return null
})
