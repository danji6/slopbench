'use node'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { sharedSessionId } from '../../lib/subagent'
import { buildWorkspaceNoteContent } from '../../model/chat/notes'
import { applyPromptCaching } from '../../model/provider/cache'
import { getProviderOptions } from '../../model/provider/options'
import { findCredentialsForModel } from '../../model/provider/providers'
import { postSidecar, sidecarDefaultShell } from '../../model/sidecar'
import type { ReasoningEffort } from '../../types'
import { buildSessionLogBody } from './engineLog'
import { patchSessionLogBody } from './engineLog'
import { buildEvalContext } from './evalContext'
import { createOperationPlan } from './operations'
import type { PromptEvalResult } from './operations'

export async function prepare(ctx: ActionCtx, streamId: Id<'streams'>) {
  const data = await ctx.runQuery(internal.streams._getContext, { streamId })
  if (!data?.stream || data.stream.status === 'stopping') return null

  // Only needed while resolving a manifest
  const defaultShell = data.sessionCache?.tools
    ? undefined
    : await sidecarDefaultShell()

  const operationPlan = createOperationPlan(data, defaultShell)

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
      authorizedWorkDirs:
        evalContext.isAdmin && evalContext.tools?.includes('read_file')
          ? evalContext.workDirs
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
      sessionId: data.stream.sessionId,
      agentId: data.stream.agentId,
      ...patch,
    })
  }

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
        sessionId: data.stream.sessionId,
      })
    },
  )

  const request = applyPromptCaching(
    {
      systemPrompt: `${systemPrompt ?? ''}\n\n${buildWorkspaceNoteContent(undefined, data.session.workspace)}`,
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
    hasActiveMedia: data.hasActiveMedia,
  }
}
