import { useStableValue } from '@/hooks/stable-value'
import type { SessionMember } from '@/lib/chat'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { OptimisticLocalStore } from 'convex/browser'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useMemo } from 'react'

import { useLinkedAgents, useOwnedAgents, useSelectAgent } from './agent'
import { useUserProfile } from './profile'
import {
  optimisticallyPatchSession,
  useActiveSession,
  useActiveSessionId,
  useActiveSessionStatus,
} from './session'
import { useSettings } from './settings'

export function useIsSessionOwner(): boolean {
  const session = useActiveSession()
  const profile = useUserProfile()
  return !!session && !!profile && session.ownerId === profile._id
}

export function useSessionMembers(): SessionMember[] {
  const session = useActiveSession()
  return (
    useQuery(
      api.userSessions.list,
      session ? { sessionId: session._id } : 'skip',
    ) ?? []
  )
}

export function useRemoveMember() {
  const session = useActiveSession()
  const remove = useMutation(api.userSessions.remove).withOptimisticUpdate(
    (store, { sessionId, userId }) => {
      const members = store.getQuery(api.userSessions.list, { sessionId })
      if (members === undefined) return
      store.setQuery(
        api.userSessions.list,
        { sessionId },
        members.filter((member) => member.membership.userId !== userId),
      )
    },
  )
  return useCallback(
    (userId: Id<'users'>) =>
      session ? remove({ sessionId: session._id, userId }) : undefined,
    [session, remove],
  )
}

export function useActivateAgent() {
  const session = useActiveSession()
  const ownedAgents = useOwnedAgents()
  const select = useSelectAgent()

  const activate = useMutation(api.sessionAgents.activate).withOptimisticUpdate(
    (store, { sessionId, agentId }) => {
      const current = store.getQuery(api.sessions.get, { sessionId })
      const activeAgentId =
        current?.activeAgentId === agentId ? undefined : agentId
      optimisticallyPatchSession(store, sessionId, { activeAgentId })
    },
  )

  return useCallback(
    (agentId: Id<'agents'>) => {
      if (!session) return
      // Synchronize with the Agents tab
      const isActivating = session.activeAgentId !== agentId
      if (isActivating && ownedAgents?.some((agent) => agent._id === agentId)) {
        select(agentId)
      }
      return activate({ sessionId: session._id, agentId })
    },
    [session, ownedAgents, select, activate],
  )
}

export function useContinueAgent() {
  const session = useActiveSession()
  const activate = useActivateAgent()
  const invoke = useMutation(api.chat.invokeAgent)

  return useCallback(
    async (agentId: Id<'agents'>) => {
      if (!session) return
      if (session.activeAgentId !== agentId) await activate(agentId)
      await invoke({ sessionId: session._id })
    },
    [session, activate, invoke],
  )
}

export function useLinkAgent() {
  const session = useActiveSession()
  const ownedAgents = useOwnedAgents()
  const link = useMutation(api.sessionAgents.link).withOptimisticUpdate(
    (store, { sessionId, agentId }) => {
      optimisticallyLinkAgent(store, sessionId, agentId, ownedAgents)
    },
  )
  return useCallback(
    (agentId: Id<'agents'>) =>
      session ? link({ sessionId: session._id, agentId }) : undefined,
    [session, link],
  )
}

export function useUnlinkAgent() {
  const session = useActiveSession()
  const unlink = useMutation(api.sessionAgents.unlink).withOptimisticUpdate(
    (store, { sessionId, agentId }) => {
      const linked = store.getQuery(api.sessionAgents.list, { sessionId })
      if (linked !== undefined) {
        store.setQuery(
          api.sessionAgents.list,
          { sessionId },
          linked.filter((agent) => agent?._id !== agentId),
        )
      }

      const session = store.getQuery(api.sessions.get, { sessionId })
      if (session?.activeAgentId === agentId) {
        optimisticallyPatchSession(store, sessionId, {
          activeAgentId: undefined,
        })
      }
    },
  )
  return useCallback(
    (agentId: Id<'agents'>) =>
      session ? unlink({ sessionId: session._id, agentId }) : undefined,
    [session, unlink],
  )
}

export type AgentPickerOption = {
  id: Id<'agents'>
  name: string
  avatarId?: Id<'avatars'>
  linked: boolean
}

export function useAgentPicker() {
  const sessionId = useActiveSessionId()
  const session = useActiveSession()
  const sessionStatus = useActiveSessionStatus()
  const owned = useOwnedAgents()
  const linked = useLinkedAgents()
  const settings = useSettings()
  const selectAgent = useSelectAgent()
  const activate = useActivateAgent()
  const link = useLinkAgent()

  const inSession = !!sessionId

  const nextLinkedIds = useMemo(
    () => new Set(linked.map((agent) => agent._id)),
    [linked],
  )

  const linkedIds = useStableValue(
    nextLinkedIds,
    inSession && sessionStatus === 'loading',
  )

  const nextOptions = useMemo<AgentPickerOption[]>(() => {
    const options =
      owned?.map((agent) => ({
        id: agent._id,
        name: agent.name,
        avatarId: agent.avatarId,
        linked: linkedIds.has(agent._id),
      })) ?? []
    const optionIds = new Set(options.map((option) => option.id))

    for (const agent of linked) {
      if (optionIds.has(agent._id)) continue
      options.push({
        id: agent._id,
        name: agent.name,
        avatarId: agent.avatarId,
        linked: true,
      })
    }

    return options
  }, [owned, linked, linkedIds])
  const options = useStableValue(
    nextOptions,
    owned === undefined || (inSession && sessionStatus === 'loading'),
  )

  const nextSelectedId = inSession
    ? session?.activeAgentId
    : settings?.recentAgentId

  const selectedId = useStableValue(
    nextSelectedId,
    inSession && sessionStatus === 'loading',
  )

  const select = useCallback(
    async (next: string) => {
      if (!inSession) return selectAgent(next || null)
      // Map an empty id back to the active agent so we can deactivate it
      const id = (next || session?.activeAgentId) as Id<'agents'> | undefined
      if (!id) return

      if (!linkedIds.has(id)) await link(id)
      await activate(id)
    },
    [inSession, selectAgent, session, linkedIds, link, activate],
  )

  return { inSession, options, linkedIds, selectedId, select }
}

function optimisticallyLinkAgent(
  store: OptimisticLocalStore,
  sessionId: Id<'sessions'>,
  agentId: Id<'agents'>,
  ownedAgents: Doc<'agents'>[] | undefined,
) {
  const linked = store.getQuery(api.sessionAgents.list, { sessionId })
  if (linked === undefined || linked.some((agent) => agent?._id === agentId)) {
    return
  }

  const owned = ownedAgents?.find((agent) => agent._id === agentId)
  if (!owned) return

  store.setQuery(api.sessionAgents.list, { sessionId }, [
    ...linked,
    {
      _id: owned._id,
      name: owned.name,
      avatarId: owned.avatarId,
      modelId: owned.modelId,
      customCss: owned.customCss,
      scrollMode: owned.scrollMode,
      mathMode: owned.mathMode,
      chatWidth: owned.chatWidth,
      theme: owned.theme,
    },
  ])
}
