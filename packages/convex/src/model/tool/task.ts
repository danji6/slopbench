import { TOOL_DESCRIPTIONS } from '@sb/core/types'

/**
 * Delegates a task to a spawnable sub-agent. The engine spawns a hidden
 * background child session and settles the tool part with a started
 * acknowledgment, and the child's report arrives later as its own
 * message in the parent session (see model/stream/subagents.ts).
 */
export async function createTaskTool(roster: string) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])

  return tool({
    description: `${TOOL_DESCRIPTIONS.task}\n\nAvailable agents:\n${roster}`,
    inputSchema: z.object({
      agent_name: z.string().describe('Name of the agent to delegate to'),
      prompt: z
        .string()
        .describe(
          'Complete standalone task, including what the report must contain',
        ),
      title: z
        .string()
        .optional()
        .describe('Short task title (3-6 words), shown to the user'),
    }),
  })
}
