import type { ShellToolOutput } from '@sb/core/types/tools'
import { block } from '@sb/core/utils/blocks'

export const SHELL_TOOL_NAME = 'shell'
export const SHELL_TOOL_PART_TYPE = `tool-${SHELL_TOOL_NAME}`

const USER_SHELL_TAG = 'user-shell'

/** Prefix of the resolved text block (see INJECTED_BLOCK_PREFIXES). */
export const USER_SHELL_BLOCK_PREFIX = `<${USER_SHELL_TAG} `

export type ShellToolPart = {
  type: string
  toolCallId: string
  state?: string
  input?: { command?: string }
  output?: ShellToolOutput
  errorText?: string
  preliminary?: boolean
  /** Last time the command was claimed in a time window (user commands only). */
  heartbeatAt?: number
}

export function isShellToolPart(part: unknown): part is ShellToolPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === SHELL_TOOL_PART_TYPE &&
    'toolCallId' in part &&
    typeof (part as ShellToolPart).toolCallId === 'string'
  )
}

/**
 * Renders a command the user ran themselves as the text block the provider
 * sees. Only `output.text` is included, without the terminal scrollback.
 */
export function toUserShellBlock(part: ShellToolPart): string {
  const command = part.input?.command ?? ''
  const output = part.output
  const body = part.errorText ?? output?.text ?? '(no output)'

  return block(USER_SHELL_TAG, `$ ${command}\n\n${body}`, {
    status: shellPartStatus(part),
    ...(output?.exitCode != null && { 'exit-code': String(output.exitCode) }),
    ...(output?.jobId && { job: output.jobId }),
  })
}

function shellPartStatus(part: ShellToolPart): string {
  if (part.state === 'output-error') return 'failed'
  if (part.state !== 'output-available') return 'running'
  return part.preliminary ? 'running' : (part.output?.status ?? 'done')
}
