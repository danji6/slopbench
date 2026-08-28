import type { Prompt } from '@/lib/chat'
import type {
  MathMode,
  ScrollMode,
  ThemeSnapshot,
  UpdateAgentArgs,
} from '@/lib/chat'
import {
  getEditingAgentId,
  subscribeEditingAgent,
} from '@/lib/chat/agent-editor-store'
import { evaluatePromptPreview, mergePrompts } from '@/lib/chat/prompts'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { EvalContext } from '@sb/core/interpreter/types'
import { toDisplayName, toOptionalName } from '@sb/core/utils/names'
import { useQuery as useCachedQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useGlobalPrompts, useLibraryPrompts, usePromptItems } from './prompts'
import { useActiveSession, useActiveSessionId } from './session'
import { useSettings, useSettingsUpdate } from './settings'
import { useIsAdmin } from './tools'

export type LinkedAgent = {
  _id: Id<'agents'>
  name: string
  avatarId?: Id<'avatars'>
  customCss?: string
  scrollMode?: ScrollMode
  mathMode?: MathMode
  chatWidth?: number
  theme?: ThemeSnapshot
}

export type ActiveAgent = Doc<'agents'> | LinkedAgent

/** The projection `api.agents.list` returns. */
export type AgentSummary = {
  _id: Id<'agents'>
  name: string
  description?: string
  avatarId?: Id<'avatars'>
}

export function useOwnedAgents(): AgentSummary[] | undefined {
  return useQuery(api.agents.list)
}

/**
 * The full document for one of the current user's agents.
 *
 * @returns `null` when the id is absent or refers to an agent they don't own,
 * `undefined` while one loads.
 */
export function useOwnedAgent(
  agentId: Id<'agents'> | null | undefined,
): Doc<'agents'> | null | undefined {
  const agent = useCachedQuery(api.agents.get, agentId ? { agentId } : 'skip')
  return agentId ? agent : null
}

export function useLinkedAgents(): LinkedAgent[] {
  const session = useActiveSession()
  const linked = useQuery(
    api.sessionAgents.list,
    session ? { sessionId: session._id } : 'skip',
  )

  return useMemo(
    () => (linked ?? []).flatMap((agent) => (agent ? [agent] : [])),
    [linked],
  )
}

export function useActiveAgent(): ActiveAgent | null {
  const sessionId = useActiveSessionId()
  const session = useActiveSession()
  const linked = useLinkedAgents()
  const settings = useSettings()

  const activeId = sessionId ? session?.activeAgentId : settings?.recentAgentId
  const owned = useOwnedAgent(activeId)
  if (!activeId) return null

  return owned ?? linked.find((agent) => agent._id === activeId) ?? null
}

/**
 * @param workDir The currently picked workspace path
 */
export function useAgentPrompts(workDir?: string) {
  const activeAgent = useActiveAgent()
  const sessionId = useActiveSessionId()
  const session = useActiveSession()
  const settings = useSettings()
  const isAdmin = useIsAdmin()
  const agent = activeAgent && 'ownerId' in activeAgent ? activeAgent : null
  const ownPrompts = usePromptItems('own', agent?._id)
  const globalPrompts = useGlobalPrompts()
  const libraryPrompts = useLibraryPrompts()

  return useMemo(() => {
    const merged = agent
      ? mergePrompts(
          {
            globalPromptsEnabled: agent.globalPromptsEnabled,
            prompts: ownPrompts,
            promptOrder: agent.promptOrder,
          },
          globalPrompts,
          libraryPrompts,
        ).items.map((m) => m.item)
      : []

    const context: EvalContext = {
      assistant: agent?.name,
      user: toOptionalName(settings?.displayName),
      owner: toDisplayName(settings?.displayName),
      tools: agent?.tools ?? [],
      isAdmin,
      userCount: 1,
      agentCount: agent ? 1 : 0,
      workDir: workDir ?? session?.workspace?.path,
    }

    const messages = merged
      .filter(
        (prompt): prompt is Prompt =>
          'visible' in prompt &&
          (sessionId
            ? prompt.visible && !prompt.starter
            : prompt.visible || prompt.starter === true),
      )
      .map((prompt) => ({
        id: prompt.id,
        role: prompt.role,
        parts: [
          {
            type: 'text' as const,
            text: evaluatePromptPreview(prompt.content, context),
          },
        ],
      }))

    const sender = agent
      ? { name: agent.name, avatarId: agent.avatarId }
      : undefined

    return { messages, sender, css: agent?.customCss || undefined }
  }, [
    agent,
    sessionId,
    settings?.displayName,
    ownPrompts,
    globalPrompts,
    libraryPrompts,
    isAdmin,
    workDir,
    session?.workspace?.path,
  ])
}

/** The id of the agent being edited. */
export function useEditingAgentId(): Id<'agents'> | null {
  const id = useSyncExternalStore(subscribeEditingAgent, getEditingAgentId)
  return id as Id<'agents'> | null
}

/** The picked agent that's being edited, `undefined` while it loads. */
export function useEditingAgent(): Doc<'agents'> | null | undefined {
  return useOwnedAgent(useEditingAgentId())
}

export function useAgentUpdate() {
  return useMutation(api.agents.update).withOptimisticUpdate(
    (localStore, { agentId, unset, ...patch }: UpdateAgentArgs) => {
      const apply = <T extends object>(agent: T): T => {
        const next = { ...agent, ...patch } as Record<string, unknown>
        for (const key of unset ?? []) delete next[key]
        return next as T
      }

      // The editor reads the document, the pickers read the list
      const agent = localStore.getQuery(api.agents.get, { agentId })
      if (agent) localStore.setQuery(api.agents.get, { agentId }, apply(agent))

      const agents = localStore.getQuery(api.agents.list, {})
      if (agents === undefined) return

      localStore.setQuery(
        api.agents.list,
        {},
        agents.map((entry) => (entry._id === agentId ? apply(entry) : entry)),
      )
    },
  )
}

/** Picks the agent outside of a session. */
export function useSelectAgent() {
  const update = useSettingsUpdate()
  const remove = useMutation(api.settings.remove)
  return useCallback(
    (agentId: string | null) => {
      // `undefined` record values are dropped, so clearing the selection
      // must go through `settings.remove`, which deletes the field.
      if (agentId === null) return void remove({ key: 'recentAgentId' })
      return void update({ patch: { recentAgentId: agentId as Id<'agents'> } })
    },
    [update, remove],
  )
}
