import type { ShellJobStatus } from '@sb/core/types/tools'
import { block } from '@sb/core/utils/blocks'

const SHELL_REPORT_TAG = 'shell-report'

export const SHELL_REPORT_PART_TYPE = SHELL_REPORT_TAG

/** Prefix of the resolved report text block (see INJECTED_BLOCK_PREFIXES). */
export const SHELL_REPORT_PREFIX = `<${SHELL_REPORT_TAG} `

/** Terminal states a watched job can report back with. */
export type ShellReportStatus =
  | Exclude<ShellJobStatus, 'running' | 'background'>
  // When the watcher itself failed and the job's outcome is unknown
  | 'failed'

/**
 * A background shell job that finished after its tool call had already
 * settled, delivered to the session as its own 'user' role message.
 */
export type ShellReportPart = {
  type: typeof SHELL_REPORT_PART_TYPE
  jobId: string
  command: string
  status: ShellReportStatus
  exitCode?: number
  text: string
}

export function isShellReportPart(part: unknown): part is ShellReportPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === SHELL_REPORT_PART_TYPE
  )
}

/** Renders a report part as the text block the provider sees. */
export function toShellReportBlock(part: ShellReportPart): string {
  return block(SHELL_REPORT_TAG, `$ ${part.command}\n\n${part.text}`, {
    job: part.jobId,
    status: part.status,
    ...(part.exitCode != null && { 'exit-code': String(part.exitCode) }),
  })
}
