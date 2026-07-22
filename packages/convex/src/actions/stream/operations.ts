'use node'

import type { ToolSet } from 'ai'

import type { ActionCtx } from '../../_generated/server'
import {
  buildExtraInstructions,
  buildPromptMessages,
  buildSystemPrompt,
  mergePrompts,
  removeStarterPrompts,
  resolveCompactionPrompts,
  resolveImpersonationPrompts,
  spliceAgentPrompts,
  splitAtMessageHistory,
} from '../../model/prompt/prompts'
import type { PromptItem } from '../../model/prompt/prompts'
import {
  type SnapshotPatch,
  planSnapshotEval,
} from '../../model/prompt/snapshots'
import {
  type ToolManifest,
  resolveToolManifest,
} from '../../model/tool/manifest'
import type { Prompt, StreamContext } from '../../types'
import { buildProviderHistory } from './history'

export type PromptEvalResult = {
  items: PromptItem[]
  environment: Record<string, unknown>
  dirty: boolean
}

export type ProviderRequest = {
  systemPrompt: string | undefined
  messages: Awaited<ReturnType<typeof buildProviderHistory>>
  tools: ToolSet
}

type OperationPlan = {
  evalItems: PromptItem[]
  /** Tool names exposed to the prompt interpreter's `tools` binding. */
  toolNames: string[]
  /** Cache row patch to persist; null for one-shot operations. */
  snapshotPatch: (evalResult: PromptEvalResult) => CachePatch | null
  buildRequest: (
    ctx: ActionCtx,
    data: StreamContext,
    evalResult: PromptEvalResult,
  ) => Promise<ProviderRequest>
}

type CachePatch = SnapshotPatch & { tools?: ToolManifest }

export function createOperationPlan(data: StreamContext): OperationPlan {
  const prompts = removeStarterPrompts(
    mergePrompts(
      data.agent,
      (data.settings?.globalPrompts ?? []) as Prompt[],
      (data.settings?.libraryPrompts ?? []) as Prompt[],
    ),
  )

  if (data.stream.operation === 'compact') {
    return createCompactPlan(data, prompts)
  }

  if (data.stream.operation === 'impersonate') {
    return createImpersonatePlan(data, prompts)
  }

  return createInvokePlan(data, prompts)
}

function createInvokePlan(
  data: StreamContext,
  prompts: PromptItem[],
): OperationPlan {
  const plan = planSnapshotEval({ cache: data.sessionCache, prompts })

  // Cached on first invoke, then reused for the rest of the session
  const frozenTools = data.sessionCache?.tools
  const manifest = frozenTools ?? resolveToolManifest(data)

  return {
    evalItems: plan.evalItems,
    toolNames: manifest.names,
    snapshotPatch: (evalResult) => {
      const patch = plan.snapshotPatch(evalResult.items)
      if (!patch && frozenTools) return null
      return { ...patch, ...(frozenTools ? {} : { tools: manifest }) }
    },
    buildRequest: (ctx, data, evalResult) =>
      buildInvokeRequest(
        ctx,
        data,
        plan.requestItems(evalResult.items),
        manifest,
      ),
  }
}

function createCompactPlan(
  data: StreamContext,
  prompts: PromptItem[],
): OperationPlan {
  const compactionPrompts = resolveCompactionPrompts(
    data.agent.compactionPrompts ?? data.settings?.compactionPrompts,
  )

  return {
    evalItems: spliceAgentPrompts(compactionPrompts, prompts),
    toolNames: [],
    snapshotPatch: () => null,
    buildRequest: (ctx, data, evalResult) =>
      buildFramedRequest(ctx, data, evalResult.items),
  }
}

function createImpersonatePlan(
  data: StreamContext,
  prompts: PromptItem[],
): OperationPlan {
  const impersonationPrompts = resolveImpersonationPrompts(
    data.agent.impersonationPrompts ?? data.settings?.impersonationPrompts,
  )

  return {
    evalItems: spliceAgentPrompts(impersonationPrompts, prompts),
    toolNames: [],
    snapshotPatch: () => null,
    buildRequest: (ctx, data, evalResult) =>
      buildFramedRequest(ctx, data, evalResult.items),
  }
}

async function buildInvokeRequest(
  ctx: ActionCtx,
  data: StreamContext,
  prompts: PromptItem[],
  manifest: ToolManifest,
): Promise<ProviderRequest> {
  const { systemPrompt, remainingPrompts } = buildSystemPrompt(
    prompts,
    (value) => value,
  )
  const [{ getEnabledTools }, messages] = await Promise.all([
    import('../../model/tool/build'),
    buildProviderHistory(ctx, data, remainingPrompts),
  ])

  return {
    systemPrompt,
    messages,
    tools: await getEnabledTools(manifest, data.session, data.settings, {
      ctx,
      autoApprove: data.agent.autoApprove,
    }),
  }
}

/**
 * Builds a request whose history is framed by operation prompts (system + a
 * message-history marker + a trailing task command), used by both compaction
 * and impersonation. The agent's own prompts are already spliced in.
 */
async function buildFramedRequest(
  ctx: ActionCtx,
  data: StreamContext,
  prompts: PromptItem[],
): Promise<ProviderRequest> {
  const { beforeHistory, afterHistory } = splitAtMessageHistory(prompts)
  const { systemPrompt, remainingPrompts } = buildSystemPrompt(
    beforeHistory,
    (value) => value,
  )
  const messages = await buildProviderHistory(ctx, data, remainingPrompts)

  messages.push(...buildPromptMessages(afterHistory, (value) => value))

  const extraInstructions = buildExtraInstructions(data.stream.instructions)
  if (extraInstructions) {
    messages.push({ role: 'user', content: extraInstructions })
  }

  return {
    systemPrompt,
    messages,
    tools: {},
  }
}
