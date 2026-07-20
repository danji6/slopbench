import { TOOL_DESCRIPTIONS, editFileFields } from '@sb/core/types'
import { systemReminder } from '@sb/core/utils/blocks'
import type { ToolSet } from 'ai'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'
import type { ShellToolOutput } from '../../types'
import type { PlanToolContext } from './context'

export async function createWritePlanTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.write_plan,
    inputSchema: z.object({
      content: z.string().describe('Complete plan content (markdown)'),
    }),
    execute: async ({ content }) => {
      await context.ctx.runMutation(internal.plans._write, {
        sessionId: context.sessionId,
        content,
      })
      return 'Plan saved.'
    },
  })
}

export async function createEditPlanTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  return tool({
    description: TOOL_DESCRIPTIONS.edit_plan,
    inputSchema: z.object({ edits: editFileFields.edits }),
    execute: async ({ edits }) => {
      const result = await context.ctx.runMutation(internal.plans._edit, {
        sessionId: context.sessionId,
        edits,
      })
      if (!result.ok) throw new ToolError(result.error)
      return 'Plan updated.'
    },
  })
}

export async function createEnterPlanModeTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  const planMode = () => isPlanMode(context.ctx, context.sessionId)

  return tool({
    description: TOOL_DESCRIPTIONS.enter_plan_mode,
    inputSchema: z.object({}),
    // Entering an already active plan mode is a no-op
    needsApproval: async () => !(await planMode()),
    execute: async () =>
      (await planMode())
        ? 'Plan mode is active. Research the task and author a plan with write_plan, then present it with exit_plan_mode.'
        : 'Plan mode is already active for this session.',
  })
}

export async function createExitPlanModeTool(context: PlanToolContext) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])
  const getPlan = () =>
    context.ctx.runQuery(internal.plans._get, { sessionId: context.sessionId })

  return tool({
    description: TOOL_DESCRIPTIONS.exit_plan_mode,
    inputSchema: z.object({}),
    needsApproval: async () => {
      const plan = await getPlan()
      return !!plan?.content.trim() && plan.status !== 'approved'
    },
    execute: async () => {
      const plan = await getPlan()
      if (!plan?.content.trim()) {
        throw new ToolError(
          'No plan exists yet. Create one with write_plan first.',
        )
      }
      return `The plan was approved. Here is the approved plan:\n\n${plan.content}\n\nPlan mode is over, proceed with the implementation.`
    },
  })
}

export async function isPlanMode(
  ctx: ActionCtx,
  sessionId: Id<'sessions'>,
): Promise<boolean> {
  const mode = await ctx.runQuery(internal.sessions._getMode, { sessionId })
  return mode === 'plan'
}

const PLAN_MODE_REMINDER = systemReminder(
  'Plan mode is active, you CANNOT make any changes. ' +
    'Keep researching and refine the plan.',
)

/** Tools whose outputs skip the plan mode reminder. */
const REMINDER_EXEMPT_TOOL_NAMES = new Set([
  'write_plan',
  'edit_plan',
  'enter_plan_mode',
  'exit_plan_mode',
  'write_todo',
  'edit_todo',
])

/** Adds the plan mode reminder to tool outputs by wrapping `execute`. */
export function withPlanModeReminders(
  tools: ToolSet,
  context?: PlanToolContext,
): ToolSet {
  if (!context) return tools
  const planMode = () => isPlanMode(context.ctx, context.sessionId)

  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute
      if (REMINDER_EXEMPT_TOOL_NAMES.has(name) || !execute)
        return [name, definition]

      // Streaming tools (shell) must return their async iterable
      // synchronously for the AI SDK to properly handle them
      const decorated = ((input, executionOptions) => {
        const result = execute(input, executionOptions)
        return isAsyncIterable(result)
          ? withReminderOnFinalOutput(result, planMode)
          : withReminderOnOutput(result, planMode)
      }) as typeof execute

      return [name, { ...definition, execute: decorated }]
    }),
  )
}

type PlanModeCheck = () => Promise<boolean>

async function withReminderOnOutput(
  result: unknown,
  planMode: PlanModeCheck,
): Promise<unknown> {
  const output = await result
  if (typeof output !== 'string' || !(await planMode())) return output
  return `${output}\n\n${PLAN_MODE_REMINDER}`
}

/** Adds the plan reminder on the final shell output. */
async function* withReminderOnFinalOutput(
  outputs: AsyncIterable<unknown>,
  planMode: PlanModeCheck,
): AsyncGenerator<unknown> {
  for await (const output of outputs) {
    yield isFinalShellOutput(output) && (await planMode())
      ? { ...output, text: `${output.text}\n\n${PLAN_MODE_REMINDER}` }
      : output
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  )
}

function isFinalShellOutput(output: unknown): output is ShellToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    typeof (output as ShellToolOutput).text === 'string' &&
    (output as ShellToolOutput).status !== 'running'
  )
}
