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
  resolvePlanPrompts,
  splitAtMessageHistory,
} from '../../model/prompt/prompts'
import type { WirePromptItem } from '../../model/prompt/prompts'
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
  items: WirePromptItem[]
  environment: Record<string, unknown>
  dirty: boolean
}

export type ProviderRequest = {
  systemPrompt: string | undefined
  messages: Awaited<ReturnType<typeof buildProviderHistory>>
  tools: ToolSet
}

type OperationPlan = {
  evalItems: WirePromptItem[]
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
  prompts: WirePromptItem[],
): OperationPlan {
  const planMode = data.stream.mode === 'plan'
  const plan = planSnapshotEval({
    cache: data.sessionCache,
    planMode,
    planPrompts: planMode
      ? resolvePlanPrompts(
          data.agent.planPrompts ?? data.settings?.planPrompts,
          !!data.session.parent,
        )
      : [],
    prompts,
  })

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
  prompts: WirePromptItem[],
): OperationPlan {
  const compactionPrompts = resolveCompactionPrompts(
    data.agent.compactionPrompts ?? data.settings?.compactionPrompts,
  )

  return {
    evalItems: [...compactionPrompts, ...prompts],
    toolNames: [],
    snapshotPatch: () => null,
    buildRequest: (ctx, data, evalResult) =>
      buildFramedRequest(ctx, data, evalResult.items, compactionPrompts.length),
  }
}

function createImpersonatePlan(
  data: StreamContext,
  prompts: WirePromptItem[],
): OperationPlan {
  const impersonationPrompts = resolveImpersonationPrompts(
    data.agent.impersonationPrompts ?? data.settings?.impersonationPrompts,
  )

  return {
    evalItems: [...impersonationPrompts, ...prompts],
    toolNames: [],
    snapshotPatch: () => null,
    buildRequest: (ctx, data, evalResult) =>
      buildFramedRequest(
        ctx,
        data,
        evalResult.items,
        impersonationPrompts.length,
      ),
  }
}

async function buildInvokeRequest(
  ctx: ActionCtx,
  data: StreamContext,
  prompts: WirePromptItem[],
  manifest: ToolManifest,
): Promise<ProviderRequest> {
  const { systemPrompt, remainingPrompts } = buildSystemPrompt(
    prompts,
    (value) => value,
  )
  const [{ getEnabledTools }, messages] = await Promise.all([
    import('../../model/tools'),
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
 * Builds a request whose history is framed by a leading block of operation
 * prompts (system + a message-history marker + a trailing task command), used
 * by both compaction and impersonation.
 *
 * @param framingPromptCount: how many of the leading prompts belong to the
 * operation versus the agent's own prompts.
 */
async function buildFramedRequest(
  ctx: ActionCtx,
  data: StreamContext,
  prompts: WirePromptItem[],
  framingPromptCount: number,
): Promise<ProviderRequest> {
  const framingPrompts = prompts.slice(0, framingPromptCount)
  const normalPrompts = prompts.slice(framingPromptCount)
  const { beforeHistory, afterHistory } = splitAtMessageHistory(framingPrompts)
  const { systemPrompt, remainingPrompts } = buildSystemPrompt(
    [...beforeHistory, ...normalPrompts],
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
