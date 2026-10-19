import { getDescription } from '@sb/core/approval-presentation'
import type { ToolApprovalConfiguration, ToolSet } from 'ai'

export const SHELL_DESCRIPTION_REQUIRED =
  'This command requires user approval and was not run because its description is missing. ' +
  'Re-run the command with a short, nonblank description explaining what it does.'

/** Denies undescribed commands only when their normal gate requires approval. */
export function shellApprovalPolicy(
  tools: ToolSet,
): ToolApprovalConfiguration<ToolSet, unknown> {
  return {
    shell: async (input, options) => {
      const gate = tools.shell?.needsApproval
      const needsApproval =
        typeof gate === 'function'
          ? await gate(input, { ...options, context: options.toolContext })
          : Boolean(gate)
      if (!needsApproval) return 'not-applicable'
      if (getDescription(input)) return 'user-approval'
      return { type: 'denied', reason: SHELL_DESCRIPTION_REQUIRED }
    },
  }
}
