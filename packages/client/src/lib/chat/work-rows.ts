import type { ShellJobSummary, ShellToolOutput } from '@cv/core/types/tools'
import type { UIMessage } from 'ai'

import { type MessageRow, segmentGroupsFor } from './rows'
import { findShellJob } from './shell-jobs-store'
import { parseOutputValue } from './tool-output'
import type { MessageRecord } from './types'
import { type ReasoningAddress, toolsInGroup } from './work-layout'
import type { WorkTransition } from './work-state'

type ProjectionOptions = {
  open: ReadonlySet<string>
  transitions?: ReadonlyMap<string, WorkTransition>
  jobs: ShellJobSummary[]
  getMessage: (id: string) => UIMessage | null
  getMetadata: (id: string) => MessageRecord | undefined
}

/** Folds work children and lets the sender header represent a lone thought. */
export function projectWorkRows(
  rows: MessageRow[],
  options: ProjectionOptions,
): MessageRow[] {
  const headerThinking = new Map(
    rows.flatMap((row) =>
      row.kind === 'header' && row.reasoning
        ? [[row.reasoning.messageId, row.reasoning] as const]
        : [],
    ),
  )
  return rows.flatMap<MessageRow>((entry, index) => {
    const reasoning = headerThinking.get(entry.messageId)
    if (isHeaderOnlyThought(entry, reasoning)) return []

    const previous = rows[index - 1]
    const continuesSenderGroup =
      previous?.grouped && isHeaderOnlyThought(previous, reasoning)
    const row = continuesSenderGroup ? { ...entry, grouped: true } : entry
    if (row.kind !== 'group' || !row.workId) return [row]

    const transition = options.transitions?.get(row.workId)
    if (options.open.has(row.workId)) return [row]
    const promotedToolCallIds = waitingTools(row, options)
    if (promotedToolCallIds.length) return [{ ...row, promotedToolCallIds }]
    return transition?.phase === 'closing' &&
      transition.mountedRows.has(row.key)
      ? [row]
      : []
  })
}

function isHeaderOnlyThought(
  row: MessageRow,
  reasoning: ReasoningAddress | undefined,
): boolean {
  return (
    row.kind === 'group' &&
    !row.workId &&
    reasoning?.messageId === row.messageId &&
    reasoning.segmentIndex === row.segmentIndex &&
    reasoning.groupIndex === row.groupIndex
  )
}

function waitingTools(
  row: Extract<MessageRow, { kind: 'group' }>,
  options: ProjectionOptions,
): string[] {
  if (!options.jobs.length) return []

  const message = options.getMessage(row.messageId)
  if (!message) return []

  const slices = segmentGroupsFor(message, options.getMetadata(row.messageId))
  const group = slices.find((slice) => slice.segmentIndex === row.segmentIndex)
    ?.groups[row.groupIndex]
  if (!group) return []

  return toolsInGroup(group)
    .filter((part) => {
      if (part.type !== 'tool-shell' && part.type !== 'tool-shell_output')
        return false

      const output = parseOutputValue<ShellToolOutput>(part.output)
      // Settled historical tools must not attach to a reused call id
      if (
        part.state === 'output-available' &&
        output?.status !== 'running' &&
        output?.status !== 'background'
      ) {
        return false
      }

      const input = parseOutputValue<{ jobId?: string }>(part.input)
      const job = findShellJob(
        options.jobs,
        output?.jobId ?? input?.jobId,
        part.toolCallId,
      )

      return Boolean(
        job?.waiting && job.status === 'running' && !job.background,
      )
    })
    .map((part) => part.toolCallId)
}
