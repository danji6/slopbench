'use node'

import type { ToolSet } from 'ai'

import type { ActionCtx } from '../../_generated/server'
import { resolveDynamicPromptMarkers } from '../../model/prompt/dynamic'
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
  buildRequest: (
    ctx: ActionCtx,
    data: StreamContext,
    evalResult: PromptEvalResult,
  ) => Promise<ProviderRequest>
}

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
  const planPrompts =
    data.stream.mode === 'plan'
      ? resolvePlanPrompts(
          data.agent.planPrompts ?? data.settings?.planPrompts,
          !!data.session.parent,
        )
      : []

  return {
    evalItems: [...planPrompts, ...prompts],
    buildRequest: (ctx, data, evalResult) =>
      buildInvokeRequest(ctx, data, evalResult.items),
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
): Promise<ProviderRequest> {
  const resolvedPrompts = await resolveDynamicPromptMarkers(data, prompts)
  const { systemPrompt, remainingPrompts } = buildSystemPrompt(
    resolvedPrompts,
    (value) => value,
  )
  const [{ getEnabledTools }, messages] = await Promise.all([
    import('../../model/tools'),
    buildProviderHistory(ctx, data, remainingPrompts),
  ])

  return {
    systemPrompt,
    messages,
    tools: await getEnabledTools(
      data.agent.tools,
      data.invoker.role,
      data.session,
      data.settings,
      {
        ctx,
        mode: data.stream.mode,
        plan: data.plan,
        autoApprove: data.agent.autoApprove,
        spawnableAgents: data.spawnableAgents,
      },
    ),
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
  const [framingPrompts, normalPrompts] = await Promise.all([
    resolveDynamicPromptMarkers(data, prompts.slice(0, framingPromptCount)),
    resolveDynamicPromptMarkers(data, prompts.slice(framingPromptCount)),
  ])
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
