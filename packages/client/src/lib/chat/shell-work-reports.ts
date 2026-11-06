import type { ShellToolOutput } from '@sb/core/types/tools'
import type { UIMessage } from 'ai'

import { isShellReportPart } from './parts'
import type { ShellReportPart } from './parts'
import type { MessageRow, SegmentGroups, segmentGroupsFor } from './rows'
import { messageDisplayRole, messageSenderKey } from './sender-groups'
import { parseOutputValue } from './tool-output'
import type { MessageRecord } from './types'
import type { ResolveWorkId, WorkShellReport } from './work-layout'
import { toolsInGroup } from './work-layout'

type WorkRow = Extract<MessageRow, { kind: 'work' }>

type GroupRow = Extract<MessageRow, { kind: 'group' }>

type ReportRowsOptions = {
  getMessage: (id: string) => UIMessage | null
  getMetadata: (id: string) => MessageRecord | undefined
  getSegments: typeof segmentGroupsFor
  groupBySender: boolean
  resolveWorkId?: ResolveWorkId
}

type ReportRowsState = {
  rows: MessageRow[]
  jobs: Map<string, WorkRow>
  options: ReportRowsOptions
}

/** Folds completed jobs into their source work without rewriting message parts. */
export function groupShellReportRows(
  rows: MessageRow[],
  options: ReportRowsOptions,
): MessageRow[] {
  const state: ReportRowsState = { rows: [], jobs: new Map(), options }
  let previousMessageId: string | undefined
  let previousSenderKey: string | null = null

  for (const row of rows) {
    const message = options.getMessage(row.messageId)
    const record = options.getMetadata(row.messageId)
    if (!message || record?.hidden) {
      state.rows.push(row)
      continue
    }
    if (row.messageId !== previousMessageId) {
      const senderKey = messageSenderKey(message, record)
      const sameSender = senderKey !== null && senderKey === previousSenderKey
      if (!options.groupBySender || !sameSender) state.jobs.clear()
      previousMessageId = row.messageId
      previousSenderKey = senderKey
    }
    appendActivityRow(state, row, message, record)
  }

  return state.rows
}

function appendActivityRow(
  state: ReportRowsState,
  row: MessageRow,
  message: UIMessage,
  record: MessageRecord | undefined,
) {
  const slices = state.options.getSegments(message, record)
  if (row.kind === 'work') {
    const workRow = { ...row, work: { ...row.work } }
    registerWorkJobs(workRow, slices, state.jobs)
    state.rows.push(workRow)
    return
  }

  const report = reportForRow(row, message, record, slices)
  if (!report || row.kind !== 'group') {
    state.rows.push(row)
    return
  }

  const owner =
    state.jobs.get(report.jobId) ??
    reportWorkRow(row, report, record, state.options.resolveWorkId)
  if (!state.jobs.has(report.jobId)) state.rows.push(owner)
  state.jobs.set(report.jobId, owner)
  addReport(owner, report)
  insertReportChild(state.rows, row, owner)
}

/** Places late output alongside the group's original activity. */
function insertReportChild(rows: MessageRow[], row: GroupRow, owner: WorkRow) {
  const workId = owner.work.id
  let index = rows.length
  for (let i = rows.length - 1; i >= 0; i--) {
    const candidate = rows[i]
    if (candidate.kind === 'group' && candidate.workId === workId) {
      index = i + 1
      break
    }
  }
  const next = rows[index]
  if (next?.messageId === owner.messageId) {
    rows[index] = { ...next, grouped: true }
  }
  rows.splice(index, 0, { ...row, workId })
}

function registerWorkJobs(
  row: WorkRow,
  slices: SegmentGroups[],
  jobs: Map<string, WorkRow>,
) {
  for (const address of row.work.groups) {
    const group = slices.find(
      (slice) => slice.segmentIndex === address.segmentIndex,
    )?.groups[address.groupIndex]
    if (!group) continue
    for (const part of toolsInGroup(group)) {
      if (part.type !== 'tool-shell') continue
      const output = parseOutputValue<ShellToolOutput>(part.output)
      if (output?.jobId) jobs.set(output.jobId, row)
    }
  }
}

function reportForRow(
  row: MessageRow,
  message: UIMessage,
  record: MessageRecord | undefined,
  slices: SegmentGroups[],
): ShellReportPart | undefined {
  if (row.kind !== 'group' || record?.type) return
  if (record?.sender?.type !== 'agent') return
  if (messageDisplayRole(message, record) !== 'assistant') return
  const group = slices.find((slice) => slice.segmentIndex === row.segmentIndex)
    ?.groups[row.groupIndex]
  if (group?.type === 'single' && isShellReportPart(group.part)) {
    return group.part
  }
}

function reportWorkRow(
  row: GroupRow,
  report: ShellReportPart,
  record: MessageRecord | undefined,
  resolveId: ResolveWorkId = (scope, calls) =>
    JSON.stringify([scope, calls[0]]),
): WorkRow {
  const scope = JSON.stringify([row.messageId, record?.selectedVersion ?? 1])
  const id = resolveId(scope, [`shell-report:${report.jobId}`])
  return {
    kind: 'work',
    key: `w:${id}`,
    messageId: row.messageId,
    ...(row.grouped && { grouped: true }),
    work: {
      id,
      groups: [{ segmentIndex: row.segmentIndex, groupIndex: row.groupIndex }],
      toolCallIds: [],
      partial: false,
    },
  }
}

function addReport(row: WorkRow, report: WorkShellReport) {
  const { jobId, status, exitCode } = report
  const previous = row.work.reports ?? []
  row.work.reports = [
    ...previous.filter((report) => report.jobId !== jobId),
    { jobId, status, exitCode },
  ]
}
