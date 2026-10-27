'use node'

import type { ToolSet } from 'ai'

import type { Doc } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import {
  buildExtraInstructions,
  buildPromptMessages,
  buildSystemPrompt,
  mergePrompts,
  removeStarterPrompts,
  resolveCompactionPrompts,
  resolveImpersonationPrompts,
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
import type { ToolAvailability } from '../../model/tool/manifest'
import type { ToolResources } from '../../model/tool/settings'
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

type CachePatch = SnapshotPatch & {
  tools?: ToolManifest
  historyPresentation?: Doc<'sessionCache'>['historyPresentation']
}

/** The web and MCP resources the tool builders read. */
export function toolResources(data: StreamContext): ToolResources {
  return { settings: data.settings, mcpServers: data.mcpServers }
}

export function createOperationPlan(
  data: StreamContext,
  defaultShell?: string,
  availability?: ToolAvailability,
): OperationPlan {
  const prompts = removeStarterPrompts(
    mergePrompts(
      { ...data.agent, prompts: data.prompts.own },
      data.prompts.library,
    ),
  )

  if (data.stream.command.kind === 'compact') {
    return createAppendPlan(
      prompts,
      resolveCompactionPrompts(data.prompts.compaction),
      data.stream.command.instructions,
    )
  }

  if (data.stream.command.kind === 'impersonate') {
    return createAppendPlan(
      prompts,
      resolveImpersonationPrompts(data.prompts.impersonation),
      data.stream.command.instructions,
    )
  }

  return createInvokePlan(data, prompts, defaultShell, availability)
}

function createInvokePlan(
  data: StreamContext,
  prompts: PromptItem[],
  defaultShell?: string,
  availability?: ToolAvailability,
): OperationPlan {
  const plan = planSnapshotEval({ cache: data.sessionCache, prompts })

  // Cached on first invoke, then reused for the rest of the session
  const frozenTools = data.sessionCache?.tools
  const frozenPresentation = data.sessionCache?.historyPresentation
  const historyPresentation = frozenPresentation ?? {
    maskOtherAgents: !!data.agent.maskOtherAgents,
    shareUserDisplayNames: !!data.agent.shareUserDisplayNames,
    shareAgentDisplayNames: !!data.agent.shareAgentDisplayNames,
  }
  const manifest =
    frozenTools ??
    resolveToolManifest({
      ...data,
      resources: toolResources(data),
      defaultShell,
      availability,
    })

  return {
    evalItems: plan.evalItems,
    toolNames: manifest.names,
    snapshotPatch: (evalResult) => {
      const patch = plan.snapshotPatch(evalResult.items)
      const capturesTools = manifest !== frozenTools
      if (!patch && !capturesTools && frozenPresentation) return null
      return {
        ...patch,
        ...(capturesTools ? { tools: manifest } : {}),
        ...(frozenPresentation ? {} : { historyPresentation }),
      }
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

/** Evaluates the agent context first, then the operation's trailing prompts. */
function createAppendPlan(
  prompts: PromptItem[],
  operationPrompts: Prompt[],
  instructions?: string,
): OperationPlan {
  return {
    evalItems: [...prompts, ...operationPrompts],
    toolNames: [],
    snapshotPatch: () => null,
    buildRequest: (ctx, data, evalResult) =>
      buildAppendRequest(
        ctx,
        data,
        evalResult.items.slice(0, prompts.length),
        evalResult.items.slice(prompts.length),
        instructions,
      ),
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
    buildProviderHistory(
      ctx,
      data,
      remainingPrompts,
      manifest.names,
      manifest.version ?? 1,
    ),
  ])

  return {
    systemPrompt,
    messages,
    tools: await getEnabledTools(
      manifest,
      { ...data.session, toolApprovals: data.toolApprovals },
      toolResources(data),
      {
        ctx,
        autoApprove: data.agent.autoApprove,
        omitMcpMedia: data.stream.omitActiveMedia,
        messageId: data.output._id,
        messageCreatedAt: data.output._creationTime,
        agentId: data.agent._id,
        invokedBy: data.stream.invokedBy,
        execution: {
          streamId: data.stream._id,
          generation: data.stream.generation,
        },
      },
    ),
  }
}

/** Appends operation instructions after the complete agent/history layout. */
async function buildAppendRequest(
  ctx: ActionCtx,
  data: StreamContext,
  prompts: PromptItem[],
  operationPrompts: PromptItem[],
  instructions?: string,
): Promise<ProviderRequest> {
  const { systemPrompt, remainingPrompts } = buildSystemPrompt(
    prompts,
    (value) => value,
  )
  const messages = await buildProviderHistory(ctx, data, remainingPrompts)

  messages.push(...buildPromptMessages(operationPrompts, (value) => value))

  const extraInstructions = buildExtraInstructions(instructions)
  if (extraInstructions) {
    messages.push({ role: 'user', content: extraInstructions })
  }

  return {
    systemPrompt,
    messages,
    tools: {},
  }
}
