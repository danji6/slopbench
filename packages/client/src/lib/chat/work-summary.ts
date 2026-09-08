import { type ToolUIPart, isReasoningUIPart } from 'ai'

import { type PartGroup, getToolStatus } from './parts'
import type { SegmentGroups } from './rows'
import { parseOutputValue } from './tool-output'
import { type WorkGroup, toolsInGroup } from './work-layout'

/** Summarizes the loaded activity; file categories count distinct paths. */
export function summarizeWork(
  work: WorkGroup,
  slices: SegmentGroups[],
  errors: string[] = [],
) {
  const groups = work.groups.flatMap((address) => {
    const group = slices.find(
      (slice) => slice.segmentIndex === address.segmentIndex,
    )?.groups[address.groupIndex]
    return group ? [group] : []
  })
  const tools = [
    ...new Map(
      groups.flatMap(toolsInGroup).map((part) => [part.toolCallId, part]),
    ).values(),
  ]
  const statuses = tools.map((part) =>
    errors.includes(part.toolCallId) ? 'error' : getToolStatus(part),
  )
  const label = activityLabel(tools)

  return {
    label: label[0].toUpperCase() + label.slice(1),
    failures: statuses.filter((status) => status === 'error').length,
    running:
      groups.some(isThinking) ||
      statuses.some((status) => status === 'running' || status === 'pending'),
  }
}

function isThinking(group: PartGroup): boolean {
  return (
    group.type === 'single' &&
    isReasoningUIPart(group.part) &&
    group.part.state === 'streaming'
  )
}

function activityLabel(tools: ToolUIPart[]): string {
  const reads = new Set<string>()
  const changes = new Set<string>()
  let commands = 0
  let other = 0

  for (const part of tools) {
    const path = toolPath(part)
    if (part.type === 'tool-read_file' && path) reads.add(path)
    else if (['tool-write_file', 'tool-edit_file'].includes(part.type) && path)
      changes.add(path)
    else if (part.type === 'tool-shell') commands++
    else if (part.type !== 'tool-shell_output') other++
  }

  return (
    [
      countLabel(reads.size, 'Read', 'file'),
      countLabel(changes.size, 'edited', 'file'),
      countLabel(commands, 'ran', 'command'),
      other ? `${other} other tool ${other === 1 ? 'call' : 'calls'}` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'Tool activity'
  )
}

function countLabel(count: number, verb: string, noun: string): string {
  return count ? `${verb} ${count} ${noun}${count === 1 ? '' : 's'}` : ''
}

function toolPath(part: ToolUIPart): string | undefined {
  // Input paths stay stable when a result adds a canonical absolute path
  const input = parseOutputValue<{ path?: unknown }>(part.input)
  const output = parseOutputValue<{ path?: unknown }>(part.output)
  const path = input?.path ?? output?.path
  return typeof path === 'string' && path.trim() ? path : undefined
}
