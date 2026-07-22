import type {
  MathMode,
  OrderedItem,
  PromptItem,
  ReasoningEffort,
  ReminderPrompt,
  ScrollMode,
  ToolMetadata,
  UpdateAgentArgs,
} from '@/lib/chat'
import { snapshotTheme } from '@/lib/theme-worker'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { AgentSubAgentsMode } from '@sb/core/types'

// All tools are off by default
export type AgentToolSelection = string[]

export type AgentFormValues = {
  name: string
  description: string
  prompts: PromptItem[]
  promptOrder?: OrderedItem[]
  globalPromptsEnabled: boolean
  reminderPrompts: ReminderPrompt[]
  libraryReminderIds: string[]
  modelId?: string | null
  reasoningEffort?: ReasoningEffort | null
  tools: AgentToolSelection
  autoApproveTools: string[]
  autoApproveShell: string[]
  subAgentsMode: AgentSubAgentsMode
  subAgentIds: Id<'agents'>[]
  // Inference
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  repeatPenalty?: number
  // Context
  trimContext: boolean
  contextWindow: number
  outputTokens: number
  shareUserDisplayNames?: boolean
  shareAgentDisplayNames?: boolean
  maskOtherAgents?: boolean
  customCss?: string
  scrollMode?: ScrollMode | null
  themeColor?: string
  mathMode?: MathMode | null
  chatWidth?: number | null
  compactionPrompts?: PromptItem[] | null
  impersonationPrompts?: PromptItem[] | null
}

/** Overridable doc fields, mapped from their form representation. Any entry
 * that resolves to `undefined` is cleared (inherited) rather than patched. */
const OVERRIDABLE_FORM_KEYS = [
  'customCss',
  'scrollMode',
  'theme',
  'mathMode',
  'chatWidth',
  'compactionPrompts',
  'impersonationPrompts',
] as const

/** Orders a set of tool names by their position in the available list. */
function orderToolNames(
  names: Set<string>,
  available: readonly ToolMetadata[],
): AgentToolSelection {
  return available.filter((t) => names.has(t.name)).map((t) => t.name)
}

/** Resolves the enabled tool names from a stored selection. */
export function getEnabledToolNames(
  tools: unknown,
  available: readonly ToolMetadata[],
): AgentToolSelection {
  return orderToolNames(new Set(Array.isArray(tools) ? tools : []), available)
}

/** Normalizes an explicit set of enabled names into a stored selection. */
export function toToolSelection(
  enabled: Iterable<string>,
  available: readonly ToolMetadata[],
): AgentToolSelection {
  return orderToolNames(new Set(enabled), available)
}

/** Maps a persisted agent document into editable form values.
 * Note: don't use undefined for controlled fields or they will
 * leak the previous agent's values. Use null to clear values,
 * otherwise react-hook-form will fall back to the field's captured
 * default.
 */
export function agentToFormValues(agent: Doc<'agents'>): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description ?? '',
    prompts: agent.prompts as PromptItem[],
    promptOrder: agent.promptOrder as OrderedItem[] | undefined,
    globalPromptsEnabled: agent.globalPromptsEnabled ?? true,
    reminderPrompts: (agent.reminderPrompts as ReminderPrompt[]) ?? [],
    libraryReminderIds: agent.libraryReminderIds ?? [],
    modelId: agent.modelId ?? null,
    reasoningEffort: (agent.reasoningEffort as ReasoningEffort | undefined) ?? null, // prettier-ignore
    tools: Array.isArray(agent.tools) ? (agent.tools as string[]) : [],
    autoApproveTools: agent.autoApprove?.tools ?? [],
    autoApproveShell: agent.autoApprove?.shell ?? [],
    subAgentsMode: agent.subAgents?.mode ?? 'allow',
    subAgentIds: agent.subAgents?.agentIds ?? [],
    temperature: agent.temperature,
    topP: agent.topP,
    frequencyPenalty: agent.frequencyPenalty,
    presencePenalty: agent.presencePenalty,
    repeatPenalty: agent.repeatPenalty,
    trimContext: agent.trimContext ?? false,
    contextWindow: agent.contextWindow ?? -1,
    outputTokens: agent.outputTokens ?? -1,
    shareUserDisplayNames: agent.shareUserDisplayNames,
    shareAgentDisplayNames: agent.shareAgentDisplayNames,
    maskOtherAgents: agent.maskOtherAgents,
    customCss: agent.customCss ?? '',
    scrollMode: agent.scrollMode,
    themeColor: agent.theme?.source ?? '',
    mathMode: agent.mathMode,
    chatWidth: agent.chatWidth,
    compactionPrompts: agent.compactionPrompts as PromptItem[] | undefined,
    impersonationPrompts: agent.impersonationPrompts as
      PromptItem[] | undefined,
  }
}

/** Maps form values into an agent update mutation payload. */
export async function formValuesToPatch(
  agentId: Doc<'agents'>['_id'],
  values: AgentFormValues,
): Promise<UpdateAgentArgs> {
  const {
    themeColor,
    customCss,
    scrollMode,
    mathMode,
    chatWidth,
    compactionPrompts,
    impersonationPrompts,
    description,
    autoApproveTools,
    autoApproveShell,
    subAgentsMode,
    subAgentIds,
    modelId,
    reasoningEffort,
    ...rest
  } = values

  const overrides = {
    customCss: customCss || undefined,
    scrollMode: scrollMode || undefined,
    theme: themeColor ? await snapshotTheme(themeColor) : undefined,
    mathMode: mathMode || undefined,
    chatWidth: chatWidth ?? undefined,
    compactionPrompts: compactionPrompts ?? undefined,
    impersonationPrompts: impersonationPrompts ?? undefined,
  }

  const patch: UpdateAgentArgs = {
    agentId,
    ...rest,
    modelId: modelId || undefined,
    reasoningEffort: reasoningEffort || undefined,
  }
  const unset: string[] = []
  for (const key of OVERRIDABLE_FORM_KEYS) {
    const value = overrides[key]
    if (value === undefined) unset.push(key)
    else (patch as Record<string, unknown>)[key] = value
  }

  const trimmedDescription = description.trim()
  if (trimmedDescription) patch.description = trimmedDescription
  else unset.push('description')

  if (autoApproveTools.length || autoApproveShell.length) {
    patch.autoApprove = {
      ...(autoApproveTools.length && { tools: autoApproveTools }),
      ...(autoApproveShell.length && { shell: autoApproveShell }),
    }
  } else unset.push('autoApprove')

  // allow + empty means "nothing spawnable", the unset default
  if (subAgentsMode === 'deny' || subAgentIds.length) {
    patch.subAgents = { mode: subAgentsMode, agentIds: subAgentIds }
  } else unset.push('subAgents')

  patch.unset = unset

  return patch
}
