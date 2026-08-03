import type { AgentPromptSets } from '@/components/chat/entities/agent/agent-form'
import { EMPTY_AGENT_PROMPT_SETS } from '@/components/chat/entities/agent/agent-form'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { PromptScope } from '@sb/convex/types'
import type { Prompt, PromptItem, ReminderPrompt } from '@sb/core/types'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation } from 'convex/react'
import { useCallback, useMemo } from 'react'

export type PromptRow = Doc<'prompts'>
export type ReminderRow = Doc<'reminders'>

export function usePromptItems(
  scope: PromptScope,
  agentId?: Id<'agents'>,
): PromptItem[] {
  const rows = usePromptRows(scope, agentId)
  return useMemo(() => (rows ?? []).map((row) => row.item), [rows])
}

export function useGlobalPrompts(): Prompt[] {
  return usePromptItems('global') as Prompt[]
}

export function useLibraryPrompts(): Prompt[] {
  return usePromptItems('library') as Prompt[]
}

export function useReminderItems(
  scope: 'own' | 'library',
  agentId?: Id<'agents'>,
): ReminderPrompt[] {
  const rows = useReminderRows(scope, agentId)
  return useMemo(() => (rows ?? []).map((row) => row.item), [rows])
}

/** The scopes the agent editor loads, or `undefined` until all arrive. */
export function useAgentPromptSets(
  agentId?: Id<'agents'>,
): AgentPromptSets | undefined {
  const prompts = usePromptRows('own', agentId)
  const reminders = useReminderRows('own', agentId)
  const compaction = usePromptRows('compaction', agentId)
  const impersonation = usePromptRows('impersonation', agentId)

  return useMemo(() => {
    if (!agentId) return EMPTY_AGENT_PROMPT_SETS
    if (!prompts || !reminders || !compaction || !impersonation)
      return undefined

    return {
      prompts: prompts.map((row) => row.item),
      reminderPrompts: reminders.map((row) => row.item),
      // An empty scope means the agent inherits the user's set
      compactionPrompts: compaction.length
        ? compaction.map((row) => row.item)
        : null,
      impersonationPrompts: impersonation.length
        ? impersonation.map((row) => row.item)
        : null,
    }
  }, [agentId, prompts, reminders, compaction, impersonation])
}

/** Persists the agent editor's scopes, one mutation per scope. */
export function useAgentPromptSetsSave() {
  const replacePrompts = useMutation(api.prompts.replaceScope)
  const replaceReminders = useMutation(api.reminders.replaceScope)

  return useCallback(
    async (agentId: Id<'agents'>, sets: AgentPromptSets) => {
      await Promise.all([
        replacePrompts({ scope: 'own', agentId, items: sets.prompts }),
        replaceReminders({
          scope: 'own',
          agentId,
          items: sets.reminderPrompts,
        }),
        // Clearing an override empties the scope, restoring the user's set
        replacePrompts({
          scope: 'compaction',
          agentId,
          items: sets.compactionPrompts ?? [],
        }),
        replacePrompts({
          scope: 'impersonation',
          agentId,
          items: sets.impersonationPrompts ?? [],
        }),
      ])
    },
    [replacePrompts, replaceReminders],
  )
}

/** The user-level prompt sets the settings dialog edits. */
export type UserPromptSets = {
  globalPrompts: Prompt[]
  libraryPrompts: Prompt[]
  libraryReminders: ReminderPrompt[]
  compactionPrompts: PromptItem[]
  impersonationPrompts: PromptItem[]
}

/** Persists the settings dialog's prompt sets, one mutation per scope. */
export function useUserPromptSetsSave() {
  const replacePrompts = useMutation(api.prompts.replaceScope)
  const replaceReminders = useMutation(api.reminders.replaceScope)

  return useCallback(
    async (sets: UserPromptSets) => {
      await Promise.all([
        replacePrompts({ scope: 'global', items: sets.globalPrompts }),
        replacePrompts({ scope: 'library', items: sets.libraryPrompts }),
        replaceReminders({
          scope: 'library',
          items: sets.libraryReminders,
        }),
        replacePrompts({
          scope: 'compaction',
          items: sets.compactionPrompts,
        }),
        replacePrompts({
          scope: 'impersonation',
          items: sets.impersonationPrompts,
        }),
      ])
    },
    [replacePrompts, replaceReminders],
  )
}

function usePromptRows(
  scope: PromptScope,
  agentId?: Id<'agents'>,
): PromptRow[] | undefined {
  const needsAgent = scope === 'own'
  return useQuery(
    api.prompts.list,
    needsAgent && !agentId ? 'skip' : { scope, ...(agentId && { agentId }) },
  )
}

function useReminderRows(
  scope: 'own' | 'library',
  agentId?: Id<'agents'>,
): ReminderRow[] | undefined {
  const needsAgent = scope === 'own'
  return useQuery(
    api.reminders.list,
    needsAgent && !agentId ? 'skip' : { scope, ...(agentId && { agentId }) },
  )
}
