import type { api } from '@cv/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'

export { updateDisabledSkills as toolkitDisabledSkills } from '@cv/core/skills/names'

export type ToolkitView = FunctionReturnType<typeof api.toolkits.list>[number]

export type ToolkitCommand = 'refresh' | 'remove'

export type ToolkitFeedback = { message: string; error?: boolean }

export type ToolkitCardFeedback = Partial<
  Record<ToolkitCommand | 'skills' | `skill:${string}`, ToolkitFeedback>
>
