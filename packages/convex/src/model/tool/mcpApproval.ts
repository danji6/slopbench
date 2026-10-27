import type { ToolExecutionOptions, ToolSet } from 'ai'

import { ToolError, extractErrorMessage } from '../../errors'

/** Reports failed approval checks as tool errors without dispatching the call. */
export function guardMcpApproval(tool: ToolSet[string]): ToolSet[string] {
  const { needsApproval, execute } = tool
  if (typeof needsApproval !== 'function' || !execute) return tool
  const failures = new Map<string, ToolError>()

  return {
    ...tool,
    needsApproval: async (
      input: unknown,
      options: ToolExecutionOptions<unknown>,
    ) => {
      if (failures.has(options.toolCallId)) return false
      try {
        return await needsApproval(input, options)
      } catch (cause) {
        failures.set(
          options.toolCallId,
          new ToolError(extractErrorMessage(cause)),
        )
        // The SDK treats approval exceptions as fatal stream errors. Defer this
        // failure to execute, which must throw before reaching the real tool.
        return false
      }
    },
    execute: async (input, options) => {
      const failure = failures.get(options.toolCallId)
      if (failure) {
        failures.delete(options.toolCallId)
        throw failure
      }
      return execute(input, options)
    },
  }
}
