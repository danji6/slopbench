import type { PromptItem, PromptMarker, PromptMarkerType } from '../../types'

export const PROMPT_MARKER_LABELS = {
  'message-history': 'Message History',
  'system-boundary': 'System Boundary',
  'agent-prompts': 'Agent Prompts',
} satisfies Record<PromptMarkerType, string>

export const PROMPT_MARKERS = Object.keys(
  PROMPT_MARKER_LABELS,
) as PromptMarkerType[]

export function getPromptMarkerLabel(type: PromptMarkerType): string {
  return PROMPT_MARKER_LABELS[type]
}

export function isPromptMarker(item: PromptItem): item is PromptMarker {
  return 'type' in item
}

/** List identity for prompt items. Markers are unique per list by type. */
export function promptItemKey(item: PromptItem): string {
  return isPromptMarker(item) ? `marker:${item.type}` : item.id
}
