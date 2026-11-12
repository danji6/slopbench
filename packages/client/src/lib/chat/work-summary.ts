import { formatDuration } from '@/lib/utils'
import type { ReasoningPart } from '@sb/convex/types'
import type { ShellToolOutput } from '@sb/core/types/tools'
import { type ToolUIPart, isReasoningUIPart } from 'ai'

import { type PartGroup, getToolStatus } from './parts'
import type { SegmentGroups } from './rows'
import { parseOutputValue } from './tool-output'
import {
  type WorkGroup,
  type WorkShellReport,
  toolsInGroup,
} from './work-layout'

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
  const { statuses, reportCommands } = workStatuses(tools, work.reports, errors)
  const activity =
    tools.length || reportCommands ? activityLabel(tools, reportCommands) : ''
  const label =
    [activity, thinkingLabel(groups)].filter(Boolean).join(', ') ||
    'Tool activity'

  return {
    label: label[0].toUpperCase() + label.slice(1),
    failures: statuses.filter((status) => status === 'error').length,
    running:
      groups.some(isThinking) ||
      statuses.some((status) => status === 'running' || status === 'pending'),
  }
}

/** Adds the recorded duration of every thinking block in the work group. */
function thinkingLabel(groups: PartGroup[]): string {
  const parts = groups.flatMap((group) =>
    group.type === 'single' && isReasoningUIPart(group.part)
      ? [group.part as ReasoningPart]
      : [],
  )
  if (!parts.length) return ''
  if (parts.some((part) => part.state === 'streaming')) return 'thinking…'
  const duration = parts.reduce(
    (total, part) => total + Math.max(0, part.duration ?? 0),
    0,
  )
  return duration > 0 ? `thought for ${formatDuration(duration)}` : 'thought'
}

/** Settles reported jobs without treating command outcomes as tool failures. */
function workStatuses(
  tools: ToolUIPart[],
  reports: WorkShellReport[] = [],
  errors: string[],
) {
  const byJob = new Map(reports.map((report) => [report.jobId, report]))
  const unmatched = new Map(byJob)

  const statuses = tools.map((part) => {
    const jobId = shellJobId(part)
    const report = jobId ? byJob.get(jobId) : undefined
    if (report) unmatched.delete(report.jobId)
    if (errors.includes(part.toolCallId)) return 'error'
    const status = getToolStatus(part)
    return report && status !== 'error' ? 'complete' : status
  })

  return { statuses, reportCommands: unmatched.size }
}

function isThinking(group: PartGroup): boolean {
  return (
    group.type === 'single' &&
    isReasoningUIPart(group.part) &&
    group.part.state === 'streaming'
  )
}

function shellJobId(part: ToolUIPart): string | undefined {
  if (part.type !== 'tool-shell') return
  return parseOutputValue<ShellToolOutput>(part.output)?.jobId
}

function activityLabel(tools: ToolUIPart[], reportCommands = 0): string {
  const reads = new Set<string>()
  const changes = new Set<string>()
  let attachmentCalls = 0
  let commands = reportCommands
  let listedSkills = false
  let other = 0

  for (const part of tools) {
    const path = toolPath(part)
    if (part.type === 'tool-read_file' && path) {
      reads.add(path)
    } else if (part.type === 'tool-read_attachment') {
      attachmentCalls++
    } else if (
      ['tool-write_file', 'tool-edit_file'].includes(part.type) &&
      path
    ) {
      changes.add(path)
    } else if (part.type === 'tool-shell') {
      commands++
    } else if (part.type === 'tool-list_skills') {
      listedSkills = true
    } else if (part.type !== 'tool-shell_output') {
      other++
    }
  }

  return (
    [
      countLabel(reads.size, 'Read', 'file'),
      attachmentCalls === 1 ? 'read attachment' : '',
      attachmentCalls > 1 ? `read attachment ×${attachmentCalls}` : '',
      countLabel(changes.size, 'edited', 'file'),
      countLabel(commands, 'ran', 'command'),
      listedSkills ? 'listed skills' : '',
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
