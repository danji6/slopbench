import { TODO_EDIT_STATUSES } from '@sb/core/const'
import { TOOL_DESCRIPTIONS } from '@sb/core/types'

import { internal } from '../../_generated/api'
import { ToolError } from '../../errors'
import type { PlanToolContext } from './context'

export async function createWriteTodoTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.write_todo,
    inputSchema: z.object({
      todos: z
        .array(z.string().min(1))
        .describe('Every task as a short string; replaces the previous list'),
    }),
    execute: async ({ todos }) => {
      await context.ctx.runMutation(internal.todos._write, {
        sessionId: context.sessionId,
        todos,
      })
      return todos.length === 0 ? 'Todos cleared.' : 'Todos updated.'
    },
  })
}

export async function createEditTodoTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.edit_todo,
    inputSchema: z.object({
      edits: z.array(
        z.object({
          task: z.string().describe('Exact text of an existing task'),
          status: z.enum(['todo', 'doing', 'done']),
        }),
      ),
    }),
    execute: async ({ edits }) => {
      const result = await context.ctx.runMutation(internal.todos._edit, {
        sessionId: context.sessionId,
        edits: edits.map(({ task, status }) => ({
          task,
          status: TODO_EDIT_STATUSES[status],
        })),
      })
      if (!result.ok) throw new ToolError(result.error)
      return 'Todos updated.'
    },
  })
}
