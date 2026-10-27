'use node'

import {
  hasFilesystemTools,
  selectedBuiltinTools,
} from '@sb/core/tool-capabilities'
import { contextEnabled } from '@sb/core/tool-context'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { minRole } from '../../lib/roles'
import { sharedSessionId } from '../../lib/subagent'
import { applyPromptCaching } from '../../model/provider/cache'
import { getProviderOptions } from '../../model/provider/options'
import { findCredentialsForModel } from '../../model/provider/providers'
import { postSidecar, sidecarDefaultShell } from '../../model/sidecar'
import { resolvePersonalWorkspace } from '../../model/skills/runtime'
import { prepareToolAvailability } from '../../model/tool/availability'
import { hasToolResultMedia } from '../../model/tool/mcpOutput'
import type { StreamExecutionArgs } from '../../types'
import type { ReasoningEffort } from '../../types'
import { buildSessionLogBody } from './engineLog'
import { patchSessionLogBody } from './engineLog'
import { buildEvalContext } from './evalContext'
import { createOperationPlan } from './operations'
import type { PromptEvalResult } from './operations'
import { prepareToolContext } from './toolContext'

export async function prepare(ctx: ActionCtx, execution: StreamExecutionArgs) {
  const data = await ctx.runQuery(internal.streams._getContext, execution)
  if (!data) return null

  const invokesTools =
    data.stream.command.kind === 'invoke' ||
    data.stream.command.kind === 'retry'
  const chosen =
    data.sessionCache?.tools?.names ?? selectedBuiltinTools(data.agent.tools)
  const observesIntegrations =
    invokesTools &&
    !!data.integrationCount &&
    (contextEnabled('mcp', chosen) || chosen.includes('list_skills')) &&
    minRole(data.invoker.role, 'admin')
  if (observesIntegrations) {
    const { observeLinkedIntegrations } = await import('../../model/integrations/actions') // prettier-ignore
    const invalidated = new Set(await observeLinkedIntegrations(ctx, execution))
    data.mcpServers = data.mcpServers.map((server) =>
      server.integrationId && invalidated.has(server.integrationId)
        ? { ...server, enabled: false }
        : server,
    )
  }
  const needsPersonalWorkspace =
    hasFilesystemTools(chosen) || chosen.includes('list_skills')
  if (needsPersonalWorkspace && minRole(data.invoker.role, 'admin')) {
    data.session.workspace = await resolvePersonalWorkspace(
      data.agent,
      data.session.workspace,
    )
  }

  // Only needed while resolving a manifest
  const needsShell =
    invokesTools &&
    !data.sessionCache?.tools &&
    data.agent.tools?.includes('shell') &&
    !!data.session.workspace &&
    minRole(data.invoker.role, 'admin')
  const defaultShell = needsShell ? await sidecarDefaultShell() : undefined

  const availability = await prepareToolAvailability(ctx, data)
  const operationPlan = createOperationPlan(data, defaultShell, availability)

  // Frozen prompts skip evaluation (see snapshots.ts)
  let evalResult: PromptEvalResult = {
    items: [],
    environment: data.environment,
    dirty: false,
  }

  if (operationPlan.evalItems.length > 0) {
    const evalContext = buildEvalContext({
      agent: data.agent,
      invoker: data.invoker,
      invokerSettings: data.invokerSettings,
      owner: data.owner,
      ownerSettings: data.ownerSettings,
      session: data.session,
      userCount: data.userCount,
      agentCount: data.agentCount,
      toolNames: operationPlan.toolNames,
    })

    evalResult = await postSidecar<PromptEvalResult>('/eval/prompts', {
      items: operationPlan.evalItems,
      context: evalContext,
      authorizedAgentId:
        evalContext.isAdmin && evalContext.tools?.includes('read_file')
          ? (data.session.workspace?.agentHome?.homeId ?? data.agent._id)
          : undefined,
      authorizedWorkDirs:
        evalContext.isAdmin && evalContext.tools?.includes('read_file')
          ? evalContext.workDirs
          : undefined,
      authorizedAgentDir:
        evalContext.isAdmin && evalContext.tools?.includes('read_file')
          ? evalContext.agentDir
          : undefined,
      authorizedWorkDir:
        evalContext.isAdmin && evalContext.tools?.includes('read_file')
          ? evalContext.workDir
          : undefined,
      environment: evalResult.environment,
    })
  }

  // The tool manifest needs freezing on the first invoke
  const patch = operationPlan.snapshotPatch(evalResult)
  if (patch) {
    await ctx.runMutation(internal.streams._saveSessionCache, {
      ...execution,
      sessionId: data.stream.sessionId,
      agentId: data.stream.agentId,
      ...patch,
      filesystemAccess: minRole(data.invoker.role, 'admin'),
    })
  }

  const contextPrepared = await prepareToolContext(
    ctx,
    execution,
    data,
    operationPlan.toolNames,
  )
  if (!contextPrepared) return null

  const { systemPrompt, messages, tools } = await operationPlan.buildRequest(
    ctx,
    data,
    evalResult,
  )

  const credentials = findCredentialsForModel(
    data.modelProviders,
    data.session.model?.id,
  )

  // Apply logging after replay filtering for more accuracy
  const requestLog: { body?: string } = {}
  const resolved = await getProviderOptions(
    data.session.model?.id,
    data.session.reasoningEffort as ReasoningEffort | undefined,
    credentials,
    async (body) => {
      requestLog.body = body
      await patchSessionLogBody(ctx, {
        body: buildSessionLogBody({ requestBody: body }),
        execution,
      })
    },
  )

  const request = applyPromptCaching(
    {
      systemPrompt,
      messages,
    },
    credentials?.providerId,
  )

  return {
    stream: data.stream,
    agent: data.agent,
    output: data.output,
    workspace: data.session.workspace,
    workspaceSessionId: sharedSessionId(data.session),
    isSubagent: !!data.session.parent,
    evalResult,
    systemPrompt: request.systemPrompt,
    messages: request.messages,
    resolved,
    requestLog,
    tools,
    hasActiveMedia: data.hasActiveMedia || hasToolResultMedia(messages),
  }
}
