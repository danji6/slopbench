import { buildRows, segmentGroupsFor } from '@/lib/chat/rows'
import type { MessageRecord } from '@/lib/chat/types'
import { buildWorkLayout } from '@/lib/chat/work-layout'
import { projectWorkRows } from '@/lib/chat/work-rows'
import type { ShellJobSummary } from '@sb/core/types/tools'
import type { UIMessage } from 'ai'

export type Part = UIMessage['parts'][number]

export const text = (text = 'commentary'): Part => ({ type: 'text', text })

export const thinking = (text = 'thinking'): Part => ({
  type: 'reasoning',
  text,
  state: 'done',
})

export const tool = (name: string, id: string, input: object = {}): Part =>
  ({
    type: `tool-${name}`,
    toolCallId: id,
    state: 'input-available',
    input,
  }) as Part

export const message = (parts: Part[], id = 'm'): UIMessage => ({
  id,
  role: 'assistant',
  parts,
})

export const meta = (parts: number[], start = 0): MessageRecord =>
  ({
    selectedVersion: 1,
    segments: parts.map((partCount, i) => ({ index: start + i, partCount })),
    hasOlderSegments: start > 0,
  }) as MessageRecord

export function layout(msg: UIMessage, record?: MessageRecord) {
  return buildWorkLayout(msg, record, segmentGroupsFor(msg, record))
}

export function rows(msg: UIMessage, record?: MessageRecord) {
  return buildRows(
    [msg.id],
    () => msg,
    () => record,
  )
}

export function project(
  msg: UIMessage,
  open = new Set<string>(),
  jobs: ShellJobSummary[] = [],
  record?: MessageRecord,
) {
  return projectWorkRows(rows(msg, record), {
    open,
    jobs,
    getMessage: () => msg,
    getMetadata: () => record,
  })
}
