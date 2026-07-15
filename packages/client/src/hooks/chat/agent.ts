import type { Prompt } from '@/lib/chat'
import type {
  MathMode,
  ScrollMode,
  ThemeSnapshot,
  UpdateAgentArgs,
} from '@/lib/chat'
import { evaluatePromptPreview, mergePrompts } from '@/lib/chat/prompts'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { EvalContext } from '@sb/core/interpreter/types'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useMemo } from 'react'

import { useActiveSession, useActiveSessionId } from './session'
import { useSettings, useSettingsUpdate } from './settings'
import { useIsAdmin } from './tools'

export type LinkedAgent = {
  _id: Id<'agents'>
  name: string
  avatarId?: Id<'avatars'>
  modelId?: string
  customCss?: string
  scrollMode?: ScrollMode
  mathMode?: MathMode
  chatWidth?: number
  theme?: ThemeSnapshot
}

export type ActiveAgent = Doc<'agents'> | LinkedAgent

export function useOwnedAgents(): Doc<'agents'>[] | undefined {
  return useQuery(api.agents.list)
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
  const owned = useOwnedAgents()
  const linked = useLinkedAgents()
  const settings = useSettings()

  const activeId = sessionId ? session?.activeAgentId : settings?.recentAgentId
  if (!activeId) return null

  return (
    owned?.find((agent) => agent._id === activeId) ??
    linked.find((agent) => agent._id === activeId) ??
    null
  )
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
  const agent = activeAgent && 'prompts' in activeAgent ? activeAgent : null

  return useMemo(() => {
    const merged = agent
      ? mergePrompts(
          {
            globalPromptsEnabled: agent.globalPromptsEnabled,
            prompts: agent.prompts,
            promptOrder: agent.promptOrder,
          },
          settings?.globalPrompts ?? [],
          settings?.libraryPrompts ?? [],
        ).items.map((m) => m.item)
      : []

    const context: EvalContext = {
      assistant: agent?.name,
      user: settings?.displayName,
      owner: settings?.displayName ?? 'User',
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
    settings?.globalPrompts,
    settings?.libraryPrompts,
    isAdmin,
    workDir,
    session?.workspace?.path,
  ])
}

export function useEditingAgent(): Doc<'agents'> | null {
  const settings = useSettings()
  const owned = useOwnedAgents()
  const id = settings?.recentAgentId
  if (!id) return null
  return owned?.find((agent) => agent._id === id) ?? null
}

export function useAgentUpdate() {
  return useMutation(api.agents.update).withOptimisticUpdate(
    (localStore, { agentId, unset, ...patch }: UpdateAgentArgs) => {
      const agents = localStore.getQuery(api.agents.list, {})
      if (agents === undefined) return

      localStore.setQuery(
        api.agents.list,
        {},
        agents.map((agent) => {
          if (agent._id !== agentId) return agent
          const next = { ...agent, ...patch } as Record<string, unknown>
          for (const key of unset ?? []) delete next[key]
          return next as (typeof agents)[number]
        }),
      )
    },
  )
}

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
