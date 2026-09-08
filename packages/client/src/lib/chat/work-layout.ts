import {
  type ToolUIPart,
  type UIMessage,
  isReasoningUIPart,
  isToolUIPart,
} from 'ai'

import { type PartGroup, isRenderablePartGroup } from './parts'
import type { SegmentGroups } from './rows'
import type { MessageRecord } from './types'

export type GroupAddress = { segmentIndex: number; groupIndex: number }

export type ReasoningAddress = GroupAddress & { messageId: string }

export type WorkGroup = {
  id: string
  groups: GroupAddress[]
  toolCallIds: string[]
  partial: boolean
}

export type LayoutGroup = GroupAddress & { group: PartGroup; workId?: string }

export type WorkLayout = { groups: LayoutGroup[]; work: WorkGroup[] }

export type ResolveWorkId = (
  scope: string,
  toolCallIds: string[],
  claimed?: ReadonlySet<string>,
) => string

/** Keeps a run's identity when paging extends either end of its loaded slice. */
export function createWorkIdentity(): ResolveWorkId {
  const ids = new Map<string, string>()
  return (scope, calls, claimed) => {
    const keys = calls.map((call) => JSON.stringify([scope, call]))
    const id =
      keys
        .map((key) => ids.get(key))
        .find((id) => id !== undefined && !claimed?.has(id)) ?? keys[0]
    for (const key of keys) ids.set(key, id)
    return id
  }
}

export function toolsInGroup(group: PartGroup): ToolUIPart[] {
  if (group.type === 'tools') return group.parts
  return group.type === 'single' && isToolUIPart(group.part)
    ? [group.part as ToolUIPart]
    : []
}

function isWorkContent(group: PartGroup): boolean {
  if (group.type === 'single' && isReasoningUIPart(group.part)) return true
  const tools = toolsInGroup(group)
  return tools.length > 0 && tools.every((part) => part.type !== 'tool-ask')
}

/** Groups activity without changing the original segment/group addresses. */
export function buildWorkLayout(
  message: UIMessage,
  record: MessageRecord | undefined,
  slices: SegmentGroups[],
  resolveId: ResolveWorkId = (scope, calls) =>
    JSON.stringify([scope, calls[0]]),
): WorkLayout {
  const all = renderableGroups(slices)

  if (message.role !== 'assistant' || record?.type)
    return { groups: all, work: [] }

  const layout: WorkLayout = { groups: [], work: [] }
  const claimed = new Set<string>()
  const scope = JSON.stringify([message.id, record?.selectedVersion ?? 1])

  for (const { entries, start, end } of activityStretches(all)) {
    if (!isWorkContent(entries[0].group)) {
      layout.groups.push(...entries)
      continue
    }

    const partial = Boolean(
      (start === 0 && record?.hasOlderSegments) ||
      (end === all.length && record?.hasNewerSegments),
    )

    const work = describeWork(entries, scope, partial, claimed, resolveId)
    if (!work) continue

    claimed.add(work.id)
    layout.work.push(work)
    layout.groups.push(
      ...entries.map((entry) => ({ ...entry, workId: work.id })),
    )
  }

  return layout
}

/** Finds the latest loaded thinking, including an empty part that just started. */
export function latestReasoning(
  messageId: string,
  slices: SegmentGroups[],
): ReasoningAddress | undefined {
  for (let s = slices.length - 1; s >= 0; s--) {
    const slice = slices[s]
    for (let g = slice.groups.length - 1; g >= 0; g--) {
      const group = slice.groups[g]
      if (group.type === 'single' && isReasoningUIPart(group.part)) {
        return { messageId, segmentIndex: slice.segmentIndex, groupIndex: g }
      }
    }
  }
}


function renderableGroups(slices: SegmentGroups[]): LayoutGroup[] {
  return slices.flatMap((slice) =>
    slice.groups.flatMap((group, groupIndex) =>
      isRenderablePartGroup(group)
        ? [{ group, groupIndex, segmentIndex: slice.segmentIndex }]
        : [],
    ),
  )
}

function activityStretches(groups: LayoutGroup[]) {
  const stretches: { entries: LayoutGroup[]; start: number; end: number }[] = []
  let start = 0
  while (start < groups.length) {
    let end = start + 1
    if (isWorkContent(groups[start].group)) {
      while (end < groups.length && isWorkContent(groups[end].group)) end++
    }
    stretches.push({ entries: groups.slice(start, end), start, end })
    start = end
  }
  return stretches
}

function describeWork(
  entries: LayoutGroup[],
  scope: string,
  partial: boolean,
  claimed: ReadonlySet<string>,
  resolveId: ResolveWorkId,
): WorkGroup | undefined {
  const toolCallIds = entries.flatMap(({ group }) =>
    toolsInGroup(group).map((part) => part.toolCallId),
  )
  if (!toolCallIds.length) return undefined
  return {
    id: resolveId(scope, toolCallIds, claimed),
    toolCallIds,
    groups: entries.map(({ segmentIndex, groupIndex }) => ({
      segmentIndex,
      groupIndex,
    })),
    partial,
  }
}
