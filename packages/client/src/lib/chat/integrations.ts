import type { api } from '@sb/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'

export { updateDisabledSkills as integrationDisabledSkills } from '@sb/core/skills/names'

export type IntegrationView = FunctionReturnType<
  typeof api.integrations.list
>[number]

export type IntegrationCommand = 'refresh' | 'remove'

export type IntegrationFeedback = { message: string; error?: boolean }

export type IntegrationCardFeedback = Partial<
  Record<IntegrationCommand | 'skills' | `skill:${string}`, IntegrationFeedback>
>
