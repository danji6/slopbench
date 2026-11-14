import type { Prompt } from '@/lib/chat'
import type {
  MathMode,
  ScrollMode,
  ThemeSnapshot,
  UpdateAgentArgs,
} from '@/lib/chat'
import {
  getEditingAgentId,
  isNewAgent,
  subscribeEditingAgent,
} from '@/lib/chat/agent-editor-store'
import { mergePrompts } from '@/lib/chat/prompts'
import { api } from '@cv/convex/_generated/api'
import type { Doc, Id } from '@cv/convex/_generated/dataModel'
import type { EvalContext } from '@cv/core/interpreter/types'
import { toDisplayName, toOptionalName } from '@cv/core/utils/names'
import { useQuery as useCachedQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useActiveModel } from './models'
import { usePromptPreviews } from './prompt-previews'
import { usePromptRows } from './prompts'
import { useActiveSession, useActiveSessionId } from './session'
import { useSettings } from './settings'
import { useIsAdmin } from './tools'

export type LinkedAgent = {
  _id: Id<'agents'>
  name: string
  avatarId?: Id<'avatars'>
  customCss?: string
  scrollMode?: ScrollMode
  mathMode?: MathMode
  chatWidth?: number
  codeBlockHighlighting?: boolean
  codeBlockLineNumbers?: boolean
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

function useLinkedAgentsQuery(sessionId?: Id<'sessions'>) {
  return useQuery(api.sessionAgents.list, sessionId ? { sessionId } : 'skip')
}

export function useLinkedAgents(): LinkedAgent[] {
  const linked = useLinkedAgentsQuery(useActiveSession()?._id)
  return useMemo(
    () => (linked ?? []).flatMap((agent) => (agent ? [agent] : [])),
    [linked],
  )
}

/** Returns undefined while the selected agent's details are still loading. */
export function useActiveAgentQuery(): ActiveAgent | null | undefined {
  const sessionId = useActiveSessionId()
  const session = useActiveSession()
  const linked = useLinkedAgentsQuery(session?._id)
  const settings = useSettings()

  const activeId = sessionId ? session?.activeAgentId : settings?.recentAgentId
  const owned = useOwnedAgent(activeId)
  if (!activeId) return null

  const agent = owned ?? linked?.find((agent) => agent?._id === activeId)
  if (agent) return agent
  if (owned === undefined || (session && linked === undefined)) return undefined
  return null
}

export function useActiveAgent(): ActiveAgent | null {
  return useActiveAgentQuery() ?? null
}

/**
 * @param workDir The currently picked workspace path
 */
export function useAgentPrompts(workDir?: string) {
  const activeAgent = useActiveAgent()
  const model = useActiveModel()
  const modelId = model?.id
  const modelName = model?.label ?? modelId
  const sessionId = useActiveSessionId()
  const session = useActiveSession()
  const settings = useSettings()
  const isAdmin = useIsAdmin()
  const agent = activeAgent && 'ownerId' in activeAgent ? activeAgent : null
  const ownRows = usePromptRows('own', agent?._id)
  const libraryRows = usePromptRows('library')

  const home = useQuery(
    api.skills.getHome,
    isAdmin && agent ? { agentId: agent._id } : 'skip',
  )

  const ownPrompts = useMemo(
    () => (ownRows ?? []).map((row) => row.item),
    [ownRows],
  )

  const libraryPrompts = useMemo(
    () =>
      (libraryRows ?? [])
        .map((row) => row.item)
        .filter((item): item is Prompt => 'content' in item),
    [libraryRows],
  )

  const data = useMemo(() => {
    const merged = agent
      ? mergePrompts(
          {
            prompts: ownPrompts,
            promptOrder: agent.promptOrder,
          },
          libraryPrompts,
        ).items.map((m) => m.item)
      : []

    const context: EvalContext = {
      assistant: agent?.name,
      user: toOptionalName(settings?.displayName),
      owner: toDisplayName(settings?.displayName),
      modelId,
      modelName,
      tools: agent?.tools ?? [],
      isAdmin,
      userCount: 1,
      agentCount: agent ? 1 : 0,
      workDir: workDir ?? session?.workspace?.path,
      agentDir: home?.path,
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
            text: prompt.content,
          },
        ],
      }))

    const sender = agent
      ? { name: agent.name, avatarId: agent.avatarId }
      : undefined

    return {
      messages,
      sender,
      css: agent?.customCss || undefined,
      context,
      texts: messages.map((message) => message.parts[0].text),
    }
  }, [
    agent,
    sessionId,
    settings?.displayName,
    modelId,
    modelName,
    home?.path,
    ownPrompts,
    libraryPrompts,
    isAdmin,
    workDir,
    session?.workspace?.path,
  ])
  const values = usePromptPreviews(data.texts, data.context)
  return {
    ...data,
    isLoading: Boolean(
      agent && (ownRows === undefined || libraryRows === undefined),
    ),
    messages: data.messages.map((message, index) => ({
      ...message,
      parts: [{ type: 'text' as const, text: values[index] }],
    })),
  }
}

/** The id of the agent being edited. */
export function useEditingAgentId(): Id<'agents'> | null {
  const id = useSyncExternalStore(subscribeEditingAgent, getEditingAgentId)
  return id as Id<'agents'> | null
}

/** Whether the editor holds a new agent that has not finished saving. */
export function useNewAgent(): boolean {
  return useSyncExternalStore(subscribeEditingAgent, isNewAgent)
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
  const select = useMutation(api.agents.select).withOptimisticUpdate(
    (store, { agentId }) => {
      const settings = store.getQuery(api.settings.get, {})
      if (!settings) return
      store.setQuery(
        api.settings.get,
        {},
        {
          ...settings,
          recentAgentId: agentId ?? undefined,
        },
      )
    },
  )
  return useCallback(
    (agentId: string | null) =>
      select({ agentId: agentId as Id<'agents'> | null }),
    [select],
  )
}
