'use node'

import type { EvalContext } from '@sb/core/interpreter/types'

import type { Doc } from '../../_generated/dataModel'
import { minRole } from '../../lib/roles'

type EvalContextInput = {
  agent: Doc<'agents'>
  invoker: Doc<'users'>
  invokerSettings: Doc<'settings'> | null
  owner: Doc<'users'>
  ownerSettings: Doc<'settings'> | null
  session: Doc<'sessions'>
  userCount: number
  agentCount: number
}

/**
 * Builds the interpreter context shared by prompt and message evaluation, so
 * every script resolves against the same variables regardless of where it runs.
 */
export async function buildEvalContext({
  agent,
  invoker,
  invokerSettings,
  ownerSettings,
  session,
  userCount,
  agentCount,
}: EvalContextInput): Promise<EvalContext> {
  const { getEnabledTools } = await import('../../model/tools')
  const isAdmin = minRole(invoker.role, 'admin')
  const tools = await getEnabledTools(
    agent.tools,
    invoker.role,
    session,
    ownerSettings,
  )

  return {
    assistant: agent.name,
    user: invokerSettings?.displayName,
    owner: ownerSettings?.displayName ?? 'User',
    tools: Object.keys(tools),
    isAdmin,
    userCount,
    agentCount,
  }
}
