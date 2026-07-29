import type {
  MathMode,
  OrderedItem,
  PromptItem,
  PromptMarkerType,
  ReasoningEffort,
  ReminderPrompt,
  ScrollMode,
  ToolMetadata,
  UpdateAgentArgs,
} from '@/lib/chat'
import { snapshotTheme } from '@/lib/theme-worker'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import { ensurePromptMarkers } from '@sb/convex/model/prompt/markers'
import type { AgentSubAgentsMode } from '@sb/core/types'

/** Structural markers every agent prompt list carries. */
export const AGENT_PROMPT_MARKERS: PromptMarkerType[] = [
  'message-history',
  'system-boundary',
]

// All tools are off by default
export type AgentToolSelection = string[]

/** Agent settings form shape. */
export type AgentFormValues = {
  name: string
  description: string
  prompts: PromptItem[]
  promptOrder: OrderedItem[] | null
  globalPromptsEnabled: boolean
  reminderPrompts: ReminderPrompt[]
  libraryReminderIds: string[]
  modelId: string | null
  reasoningEffort: ReasoningEffort | null
  tools: AgentToolSelection
  autoApproveTools: string[]
  autoApproveShell: string[]
  subAgentsMode: AgentSubAgentsMode
  subAgentIds: Id<'agents'>[]
  // Inference
  temperature: number | null
  topP: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
  repeatPenalty: number | null
  // Context
  trimContext: boolean
  contextWindow: number
  outputTokens: number
  shareUserDisplayNames: boolean
  shareAgentDisplayNames: boolean
  maskOtherAgents: boolean
  customCss: string
  scrollMode: ScrollMode | null
  themeColor: string
  mathMode: MathMode | null
  chatWidth: number | null
  compactionPrompts: PromptItem[] | null
  impersonationPrompts: PromptItem[] | null
}

/** The form's shape for an agent that does not exist yet. */
export const EMPTY_AGENT_FORM: AgentFormValues = {
  name: '',
  description: '',
  prompts: ensurePromptMarkers([], AGENT_PROMPT_MARKERS),
  promptOrder: null,
  globalPromptsEnabled: true,
  reminderPrompts: [],
  libraryReminderIds: [],
  modelId: null,
  reasoningEffort: null,
  tools: [],
  autoApproveTools: [],
  autoApproveShell: [],
  subAgentsMode: 'allow',
  subAgentIds: [],
  temperature: null,
  topP: null,
  frequencyPenalty: null,
  presencePenalty: null,
  repeatPenalty: null,
  trimContext: false,
  contextWindow: -1,
  outputTokens: -1,
  shareUserDisplayNames: false,
  shareAgentDisplayNames: false,
  maskOtherAgents: false,
  customCss: '',
  scrollMode: null,
  themeColor: '',
  mathMode: null,
  chatWidth: null,
  compactionPrompts: null,
  impersonationPrompts: null,
}

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
 * Update: `AgentFormValues` has no optional fields anymore.
 */
export function agentToFormValues(agent: Doc<'agents'>): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description ?? '',
    prompts: ensurePromptMarkers(
      agent.prompts as PromptItem[],
      AGENT_PROMPT_MARKERS,
    ),
    promptOrder: (agent.promptOrder as OrderedItem[] | undefined) ?? null,
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
    temperature: agent.temperature ?? null,
    topP: agent.topP ?? null,
    frequencyPenalty: agent.frequencyPenalty ?? null,
    presencePenalty: agent.presencePenalty ?? null,
    repeatPenalty: agent.repeatPenalty ?? null,
    trimContext: agent.trimContext ?? false,
    contextWindow: agent.contextWindow ?? -1,
    outputTokens: agent.outputTokens ?? -1,
    shareUserDisplayNames: agent.shareUserDisplayNames ?? false,
    shareAgentDisplayNames: agent.shareAgentDisplayNames ?? false,
    maskOtherAgents: agent.maskOtherAgents ?? false,
    customCss: agent.customCss ?? '',
    scrollMode: agent.scrollMode ?? null,
    themeColor: agent.theme?.source ?? '',
    mathMode: agent.mathMode ?? null,
    chatWidth: agent.chatWidth ?? null,
    compactionPrompts: (agent.compactionPrompts as PromptItem[] | undefined) ?? null, // prettier-ignore
    impersonationPrompts: (agent.impersonationPrompts as PromptItem[] | undefined) ?? null, // prettier-ignore
  }
}

type Clearable<T> = { [K in keyof T]: T[K] | null }
type PatchFields = Clearable<Omit<UpdateAgentArgs, 'agentId' | 'unset'>>
type Absent<T> = { [K in keyof T]: Exclude<T[K], null> | undefined }

/** Drops what the form holds as `null`. */
function omitNulls<T extends object>(values: T): Absent<T> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value ?? undefined]),
  ) as Absent<T>
}

/**
 * Maps form values into an agent update mutation payload. `null` fields are
 * cleared from the doc.
 */
export async function formValuesToPatch(
  agentId: Doc<'agents'>['_id'],
  values: AgentFormValues,
): Promise<UpdateAgentArgs> {
  const {
    themeColor,
    customCss,
    description,
    autoApproveTools,
    autoApproveShell,
    subAgentsMode,
    subAgentIds,
    modelId,
    reasoningEffort,
    ...rest
  } = values

  const fields: PatchFields = {
    ...rest,
    modelId: modelId || null,
    reasoningEffort: reasoningEffort || null,
    description: description.trim() || null,
    customCss: customCss || null,
    theme: themeColor ? await snapshotTheme(themeColor) : null,
    autoApprove:
      autoApproveTools.length || autoApproveShell.length
        ? {
            ...(autoApproveTools.length && { tools: autoApproveTools }),
            ...(autoApproveShell.length && { shell: autoApproveShell }),
          }
        : null,
    // allow + empty means "nothing spawnable", the unset default
    subAgents:
      subAgentsMode === 'deny' || subAgentIds.length
        ? { mode: subAgentsMode, agentIds: subAgentIds }
        : null,
  }

  return {
    agentId,
    ...omitNulls(fields),
    unset: Object.entries(fields)
      .filter(([, value]) => value === null)
      .map(([key]) => key),
  }
}
