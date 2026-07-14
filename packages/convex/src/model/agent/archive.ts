import { generateId } from '../../lib/utils'
import type { CreateAgentArgs, Prompt, PromptItem } from '../../types'
import type { PromptOrderRef } from '../prompt/merge'

export const AGENT_ARCHIVE_VERSION = 1

export type AgentArchive = {
  version: typeof AGENT_ARCHIVE_VERSION
  exportedAt: number
  agent: CreateAgentArgs
}

const PROMPT_ROLES = ['system', 'user', 'assistant'] as const
const PROMPT_MARKER_TYPES = ['message-history', 'agents'] as const
const SCROLL_MODES = ['follow', 'into-view'] as const

// subAgents is deliberately excluded here as ids don't survive import/export
const PASSTHROUGH_KEYS = [
  'name',
  'description',
  'tools',
  'globalPromptsEnabled',
  'modelId',
  'reasoningEffort',
  'temperature',
  'topP',
  'frequencyPenalty',
  'presencePenalty',
  'repeatPenalty',
  'trimContext',
  'contextWindow',
  'outputTokens',
  'shareUserDisplayNames',
  'shareAgentDisplayNames',
  'maskOtherAgents',
  'customCss',
] as const

export function createAgentArchive(
  data: Record<string, unknown>,
  libraryPrompts: Prompt[] = [],
  exportedAt = Date.now(),
): AgentArchive {
  return {
    version: AGENT_ARCHIVE_VERSION,
    exportedAt,
    agent: sanitizeAgentExportData(inlineLibraryPrompts(data, libraryPrompts)),
  }
}

export function agentArchiveToCreateArgs(payload: unknown): CreateAgentArgs {
  if (!isRecord(payload)) throw new Error('Invalid agent archive')

  if (typeof payload.version === 'number') {
    if (payload.version !== AGENT_ARCHIVE_VERSION) {
      throw new Error(`Unsupported agent archive version: ${payload.version}`)
    }
    if (!isRecord(payload.agent)) throw new Error('Invalid agent archive data')
    return sanitizeAgentExportData(payload.agent)
  }

  return sanitizeAgentExportData(payload)
}

export function sanitizeAgentExportData(
  data: Record<string, unknown>,
): CreateAgentArgs {
  const agent: Record<string, unknown> = {}
  for (const key of PASSTHROUGH_KEYS) {
    if (data[key] !== undefined) agent[key] = data[key]
  }

  agent.prompts = toArray(data.prompts)
    .map(sanitizePromptItem)
    .filter(isPromptItem)

  const promptOrder = toArray(data.promptOrder).filter(isPromptOrderRef)
  if (promptOrder.length) agent.promptOrder = promptOrder
  if (isScrollMode(data.scrollMode)) agent.scrollMode = data.scrollMode
  if (isThemeSnapshot(data.theme)) agent.theme = data.theme

  const autoApprove = sanitizeAutoApprove(data.autoApprove)
  if (autoApprove) agent.autoApprove = autoApprove

  return agent as CreateAgentArgs
}

function sanitizeAutoApprove(value: unknown) {
  if (!isRecord(value)) return null
  const tools = toArray(value.tools).filter((t) => typeof t === 'string')
  const shell = toArray(value.shell).filter((t) => typeof t === 'string')
  if (!tools.length && !shell.length) return null
  return {
    ...(tools.length && { tools }),
    ...(shell.length && { shell }),
  }
}

function inlineLibraryPrompts(
  data: Record<string, unknown>,
  libraryPrompts: Prompt[],
): Record<string, unknown> {
  const order = toArray(data.promptOrder).filter(isPromptOrderRef)
  if (!order.length) return data

  const libraryById = new Map(libraryPrompts.map((p) => [p.id, p]))
  const prompts = [...toArray(data.prompts)] as Prompt[]

  const promptOrder = order.flatMap((ref): PromptOrderRef[] => {
    if (ref.kind !== 'library') return [ref]
    const prompt = libraryById.get(ref.id)
    if (!prompt) return []
    const copy = { ...prompt, id: generateId() }
    prompts.push(copy)
    return [{ kind: 'own', id: copy.id }]
  })

  return { ...data, prompts, promptOrder }
}

function sanitizePromptItem(value: unknown): PromptItem | null {
  if (!isRecord(value)) return null

  if (isPromptMarkerType(value.type)) {
    return {
      id: typeof value.id === 'string' ? value.id : generateId(),
      type: value.type,
    }
  }

  if (typeof value.content !== 'string') return null

  return {
    id: typeof value.id === 'string' ? value.id : generateId(),
    name: typeof value.name === 'string' ? value.name : 'System',
    role: isPromptRole(value.role) ? value.role : 'system',
    content: value.content,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    visible: typeof value.visible === 'boolean' ? value.visible : false,
    starter: typeof value.starter === 'boolean' ? value.starter : false,
  }
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isPromptItem(item: PromptItem | null): item is PromptItem {
  return item !== null
}

function isPromptRole(value: unknown): value is (typeof PROMPT_ROLES)[number] {
  return PROMPT_ROLES.includes(value as (typeof PROMPT_ROLES)[number])
}

function isPromptMarkerType(
  value: unknown,
): value is (typeof PROMPT_MARKER_TYPES)[number] {
  return PROMPT_MARKER_TYPES.includes(
    value as (typeof PROMPT_MARKER_TYPES)[number],
  )
}

function isPromptOrderRef(value: unknown): value is PromptOrderRef {
  return (
    isRecord(value) &&
    (value.kind === 'own' ||
      value.kind === 'global' ||
      value.kind === 'library') &&
    typeof value.id === 'string'
  )
}

function isScrollMode(value: unknown): value is (typeof SCROLL_MODES)[number] {
  return SCROLL_MODES.includes(value as (typeof SCROLL_MODES)[number])
}

function isThemeSnapshot(
  value: unknown,
): value is NonNullable<CreateAgentArgs['theme']> {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    isStringRecord(value.light) &&
    isStringRecord(value.dark)
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
