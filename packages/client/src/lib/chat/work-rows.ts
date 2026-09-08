import type { ShellJobSummary, ShellToolOutput } from '@sb/core/types/tools'
import type { UIMessage } from 'ai'

import { type MessageRow, segmentGroupsFor } from './rows'
import { findShellJob } from './shell-jobs-store'
import { parseOutputValue } from './tool-output'
import type { MessageRecord } from './types'
import { toolsInGroup } from './work-layout'
import type { WorkTransition } from './work-state'

type ProjectionOptions = {
  open: ReadonlySet<string>
  transitions?: ReadonlyMap<string, WorkTransition>
  jobs: ShellJobSummary[]
  getMessage: (id: string) => UIMessage | null
  getMetadata: (id: string) => MessageRecord | undefined
}

/** Keeps work children virtualized and promotes only terminals awaiting input. */
export function projectWorkRows(
  rows: MessageRow[],
  options: ProjectionOptions,
): MessageRow[] {
  return rows.flatMap((row) => {
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
