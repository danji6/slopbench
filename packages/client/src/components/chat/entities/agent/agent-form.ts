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

/** The agent's prompt rows, grouped by scope. */
export type AgentPromptSets = {
  prompts: PromptItem[]
  reminderPrompts: ReminderPrompt[]
  // `null` means "inherit the user's set"
  compactionPrompts: PromptItem[] | null
  impersonationPrompts: PromptItem[] | null
}

export const EMPTY_AGENT_PROMPT_SETS: AgentPromptSets = {
  prompts: [],
  reminderPrompts: [],
  compactionPrompts: null,
  impersonationPrompts: null,
}

/** Structural markers every agent prompt list carries. */
export const AGENT_PROMPT_MARKERS: PromptMarkerType[] = [
  'message-history',
  'system-boundary',
]

// All tools are off by default
export type AgentToolSelection = string[]

/** The half of the form stored as fields on the agent document. */
export type AgentDocValues = {
  name: string
  description: string
  promptOrder: OrderedItem[] | null
  globalPromptsEnabled: boolean
  libraryReminderIds: string[]
  modelId: string | null
  reasoningEffort: ReasoningEffort | null
  tools: AgentToolSelection
  shell: string
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
}

/** The full agent settings form shape. */
export type AgentFormValues = AgentDocValues & AgentPromptSets

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
  shell: '',
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
  tools: string[] | undefined,
  available: readonly ToolMetadata[],
): AgentToolSelection {
  return orderToolNames(new Set(tools), available)
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
export function agentToFormValues(
  agent: Doc<'agents'>,
  sets: AgentPromptSets,
): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description ?? '',
    prompts: ensurePromptMarkers(sets.prompts, AGENT_PROMPT_MARKERS),
    promptOrder: (agent.promptOrder as OrderedItem[] | undefined) ?? null,
    globalPromptsEnabled: agent.globalPromptsEnabled ?? true,
    reminderPrompts: sets.reminderPrompts,
    libraryReminderIds: agent.libraryReminderIds ?? [],
    modelId: agent.modelId ?? null,
    reasoningEffort: (agent.reasoningEffort as ReasoningEffort | undefined) ?? null, // prettier-ignore
    tools: agent.tools ?? [],
    shell: agent.shell ?? '',
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
    compactionPrompts: sets.compactionPrompts,
    impersonationPrompts: sets.impersonationPrompts,
  }
}

/**
 * Separates the two places the form persists to: the agent document, and the
 * prompt and reminder rows.
 */
export function splitAgentForm(values: AgentFormValues): {
  doc: AgentDocValues
  sets: AgentPromptSets
} {
  const {
    prompts,
    reminderPrompts,
    compactionPrompts,
    impersonationPrompts,
    ...doc
  } = values

  return {
    doc,
    sets: { prompts, reminderPrompts, compactionPrompts, impersonationPrompts },
  }
}

type Clearable<T> = { [K in keyof T]: T[K] | null }
type PatchFields = Clearable<Omit<UpdateAgentArgs, 'agentId' | 'unset'>>
type ClearableKey = keyof Omit<PatchFields, 'name'>
type Absent<T> = { [K in keyof T]: Exclude<T[K], null> | undefined }

/** Drops what the form holds as `null`. */
function omitNulls<T extends object>(values: T): Absent<T> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value ?? undefined]),
  ) as Absent<T>
}

/**
 * Maps the document half of the form into an update mutation payload. `null`
 * fields are cleared from the doc.
 */
export async function formValuesToPatch(
  agentId: Doc<'agents'>['_id'],
  values: AgentDocValues,
): Promise<UpdateAgentArgs> {
  const {
    themeColor,
    customCss,
    description,
    shell,
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
    shell: shell.trim() || null,
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
    unset: clearedFields(fields),
  }
}

/** The field names the form is asking to clear. */
function clearedFields(fields: PatchFields): ClearableKey[] {
  const { name: _name, ...clearable } = fields
  return (Object.keys(clearable) as ClearableKey[]).filter(
    (key) => clearable[key] === null,
  )
}
