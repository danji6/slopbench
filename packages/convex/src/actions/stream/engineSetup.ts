'use node'

import { stableStringify } from '@cv/core/stable-json'
import {
  hasFilesystemTools,
  selectedBuiltinTools,
} from '@cv/core/tool-capabilities'
import { contextEnabled } from '@cv/core/tool-context'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { minRole } from '../../lib/roles'
import { sharedSessionId } from '../../lib/subagent'
import { hasSavedTitle } from '../../model/messages'
import { applyPromptCaching } from '../../model/provider/cache'
import { getProviderOptions } from '../../model/provider/options'
import { findCredentialsForModel } from '../../model/provider/providers'
import { postSidecar, sidecarDefaultShell } from '../../model/sidecar'
import { resolvePersonalWorkspace } from '../../model/skills/runtime'
import { prepareToolAvailability } from '../../model/tool/availability'
import { capabilitySource } from '../../model/tool/capabilitySource'
import { resolveToolManifest } from '../../model/tool/manifest'
import { hasToolResultMedia } from '../../model/tool/mcpOutput'
import { filesystemWorkspace } from '../../model/tool/sessionFilesystem'
import { prepareSessionTools } from '../../model/tool/sessionTools'
import type { StreamExecutionArgs } from '../../types'
import type { ReasoningEffort } from '../../types'
import { buildSessionLogBody } from './engineLog'
import { patchSessionLogBody } from './engineLog'
import { buildEvalContext } from './evalContext'
import { createOperationPlan, toolResources } from './operations'
import type { PromptEvalResult } from './operations'
import { prepareToolContext } from './toolContext'

export async function prepare(ctx: ActionCtx, execution: StreamExecutionArgs) {
  let data = await ctx.runQuery(internal.streams._getContext, execution)
  if (!data) return null

  const invokesTools =
    data.stream.command.kind === 'invoke' ||
    data.stream.command.kind === 'retry'
  const chosen = selectedBuiltinTools(data.agent.tools)
  const observesToolkits =
    invokesTools &&
    !!data.toolkitCount &&
    (contextEnabled('mcp', chosen) || chosen.includes('list_skills')) &&
    minRole(data.invoker.role, 'admin')
  if (observesToolkits) {
    const { observeLinkedToolkits } = await import('../../model/toolkits/actions') // prettier-ignore
    const invalidated = new Set(await observeLinkedToolkits(ctx, execution))
    if (invalidated.size) {
      data = await ctx.runQuery(internal.streams._getContext, execution)
      if (!data) return null
    }
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
    data.agent.tools?.includes('shell') &&
    minRole(data.invoker.role, 'admin')
  const defaultShell = needsShell ? await sidecarDefaultShell() : undefined

  const capturesFiles =
    invokesTools &&
    minRole(data.invoker.role, 'admin') &&
    chosen.some((name) =>
      ['write_file', 'edit_file', 'shell', 'task'].includes(name),
    )
  if (capturesFiles) {
    const { prepareChanges } = await import('../session/changes')
    if (!(await prepareChanges(ctx, execution, data))) return null
  }

  const availability = await prepareToolAvailability(ctx, data)
  const runtime = invokesTools
    ? await prepareSessionTools(
        ctx,
        data,
        resolveToolManifest({
          ...data,
          resources: toolResources(data),
          defaultShell,
          availability,
        }),
      )
    : undefined
  const operationPlan = createOperationPlan(
    data,
    defaultShell,
    availability,
    runtime,
  )

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

  const source = runtime ? await capabilitySource(data) : undefined
  const capabilitiesChanged =
    runtime &&
    (source !== data.sessionCache?.capabilitySource ||
      stableStringify(runtime.current) !==
        stableStringify(data.sessionCache?.effectiveTools) ||
      availability.source !== data.stream.skillCatalogSource)
  if (runtime && capabilitiesChanged) {
    const accepted = await ctx.runMutation(
      internal.streams._prepareCapabilities,
      {
        ...execution,
        source: source!,
        manifest: runtime.current,
        contextId: runtime.frozen.contextId!,
        skillCatalogSource: availability.source,
        skillAvailability: {
          skills: !!availability.skills,
        },
      },
    )
    if (!accepted) {
      await ctx.runMutation(internal.streams._handoff, execution)
      return null
    }
  }

  const contextPrepared = await prepareToolContext(
    ctx,
    execution,
    data,
    operationPlan.toolNames,
    runtime?.frozen.contextId,
    availability,
  )
  if (!contextPrepared) return null

  const { systemPrompt, messages, tools, toolRuntime } =
    await operationPlan.buildRequest(ctx, data, evalResult)

  const credentials = findCredentialsForModel(
    data.modelProviders,
    data.session.model?.id,
  )

  const { createCacheDiagnostics } = await import('./cacheDiagnostics')
  const isChatGPT =
    credentials?.providerId === 'openai' && credentials.auth === 'chatgpt'
  const cacheDiagnostics = isChatGPT
    ? createCacheDiagnostics(ctx, {
        execution,
        messageId: data.stream.state.processingMessageId,
        attempt: data.stream.attempt,
        credentials,
      })
    : undefined
  if (!isChatGPT && data.stream.providerContinuity) {
    await ctx.runMutation(internal.streams._clearProviderContinuity, execution)
  }

  // Apply logging after replay filtering for more accuracy
  const requestLog: { body?: string } = {}
  const resolved = await getProviderOptions(
    data.session.model?.id,
    data.session.reasoningEffort as ReasoningEffort | undefined,
    credentials,
    {
      cacheKey: data.stream.sessionId,
      observeTransport: cacheDiagnostics?.observeTransport,
      onRequest: async (body) => {
        requestLog.body = body
        await patchSessionLogBody(ctx, {
          body: buildSessionLogBody({ requestBody: body }),
          execution,
        })
      },
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
    workspace: hasFilesystemTools(operationPlan.toolNames)
      ? filesystemWorkspace(data.session)
      : data.session.workspace,
    workspaceSessionId: sharedSessionId(data.session),
    isSubagent: !!data.session.parent,
    needsTitle:
      data.stream.command.kind === 'invoke' && !hasSavedTitle(data.session),
    evalResult,
    systemPrompt: request.systemPrompt,
    messages: request.messages,
    resolved,
    requestLog,
    cacheDiagnostics,
    tools,
    toolRuntime,
    hasActiveMedia: data.hasActiveMedia || hasToolResultMedia(messages),
  }
}
