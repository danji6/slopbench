import { stableStringify } from '@cv/core/stable-json'
import { TOOL_CAPABILITIES } from '@cv/core/tool-capabilities'
import { MCP_BROKER_TOOLS } from '@cv/core/types/mcp-catalog'
import { withAgentHome } from '@cv/core/workspace/personal'

import type { QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { minRole } from '../../lib/roles'
import type { AssertToolAccessArgs } from '../../types'
import { resolveSpawnableAgents } from '../agent/subagents'
import { resolve as resolveMcpServers } from '../mcp'
import { getSessionWithWorkspace } from '../session/folderContext'
import { requireEnabled } from '../session/memberships'
import { getByOwnerId } from '../settings'
import { agentWithHome } from '../skills/homes'
import { ownsExecution } from '../stream/execution'
import { resolveToolManifest } from './manifest'

/** Rechecks selection and prerequisites immediately before approval and execution. */
export async function assertToolAccess(
  ctx: QueryCtx,
  args: AssertToolAccessArgs,
) {
  const actor = await invocationActor(ctx, args)
  requireToolRole(args.name, actor.invoker.role)

  const current = await currentManifest(ctx, args, actor)
  if (!current.names.includes(args.name))
    error('Tool is no longer enabled', 403)

  const external = args.manifest.mcp?.find((entry) => entry.name === args.name)
  const target = current.mcp?.find((entry) => entry.name === args.name)
  const externalChanged = external && stableStringify(external) !== stableStringify(target) // prettier-ignore
  const shellChanged = args.name === 'shell' && current.shell !== args.manifest.shell // prettier-ignore
  if (externalChanged || shellChanged)
    error('Tool contract changed; get_tool before calling it again', 409)

  return true
}

async function invocationActor(ctx: QueryCtx, args: AssertToolAccessArgs) {
  const stream = await ctx.db.get(args.streamId)
  if (!ownsExecution(stream, args))
    error('Tool invocation is no longer active', 409)

  const [agent, invoker, session] = await Promise.all([
    agentWithHome(ctx, stream.agentId),
    ctx.db.get(stream.invokedBy),
    getSessionWithWorkspace(ctx, stream.sessionId),
  ])
  if (!agent || !invoker || !session)
    error('Tool invocation is no longer available', 409)

  requireEnabled(session)
  if (session.contextLock) error('Folder sources are being updated', 409)

  return { agent, invoker, session }
}

type ToolActor = Awaited<ReturnType<typeof invocationActor>>

function requireToolRole(name: string, role: ToolActor['invoker']['role']) {
  const capability = TOOL_CAPABILITIES.find((entry) =>
    (entry.tools as readonly string[]).includes(name),
  )
  const requiresAdmin =
    capability && 'requiresAdmin' in capability && capability.requiresAdmin
  if (requiresAdmin && !minRole(role, 'admin')) error('Forbidden', 403)
}

async function currentManifest(
  ctx: QueryCtx,
  args: AssertToolAccessArgs,
  actor: ToolActor,
) {
  const { agent, invoker, session } = actor
  const settings = await getByOwnerId(ctx, agent.ownerId)
  const external = args.manifest.mcp?.some((entry) => entry.name === args.name)
  const needsMcp =
    external || (MCP_BROKER_TOOLS as readonly string[]).includes(args.name)

  const mcpServers = needsMcp
    ? await resolveMcpServers(ctx, agent.ownerId, {
        agentId: agent._id,
        sessionId: session._id,
      })
    : []

  return resolveToolManifest({
    agent,
    invoker,
    session: { ...session, workspace: personalWorkspace(actor) },
    settings,
    resources: { settings, mcpServers },
    spawnableAgents:
      args.name === 'task' ? await resolveSpawnableAgents(ctx, agent) : [],
    defaultShell: args.manifest.shell,
    availability: {
      skills: args.manifest.names.includes('list_skills'),
      toolkitSkills: args.manifest.names.includes('read_skill'),
      storedMcpOutput: args.manifest.names.includes('read_mcp_output'),
    },
  })
}

function personalWorkspace({ agent, session }: ToolActor) {
  const home = agent.home
  if (!home?.path) return session.workspace
  return {
    ...withAgentHome(session.workspace, {
      ownerId: agent.ownerId,
      agentId: agent._id,
      homeId: agent.homeId,
      originAgentId: home.originAgentId,
      path: home.path,
      revision: home.revision,
    }),
    folderId: session.workspace?.folderId,
  }
}
