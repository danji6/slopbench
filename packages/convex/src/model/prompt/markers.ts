import type { PromptItem, PromptMarker, PromptMarkerType } from '../../types'

// Declaration order is the insertion order
export const PROMPT_MARKER_LABELS = {
  'message-history': 'Message History',
  'agent-prompts': 'Agent Prompts',
  'system-boundary': 'System Boundary',
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

export function findPromptMarker(
  items: PromptItem[],
  type: PromptMarkerType,
): number {
  return items.findIndex((item) => isPromptMarker(item) && item.type === type)
}

/**
 * Adds every marker in `markers` that `items` is missing, each at the position
 * that reproduces the behaviour of its absence.
 */
export function ensurePromptMarkers(
  items: PromptItem[],
  markers: PromptMarkerType[],
): PromptItem[] {
  const missing = PROMPT_MARKERS.filter(
    (type) => markers.includes(type) && findPromptMarker(items, type) === -1,
  )

  return missing.reduce<PromptItem[]>((result, type) => {
    const at = MARKER_POSITION[type](result)
    const marker: PromptMarker = { type }
    return at === -1
      ? [...result, marker]
      : [...result.slice(0, at), marker, ...result.slice(at)]
  }, items)
}

/** Default index of a missing marker, `-1` appending it to the end. */
const MARKER_POSITION: Record<
  PromptMarkerType,
  (items: PromptItem[]) => number
> = {
  // The system block already ends at the first item that cannot extend it
  'system-boundary': (items) => items.findIndex((i) => !extendsSystemBlock(i)),
  // Agent prompts are spliced in just before the history when unmarked
  'agent-prompts': (items) => findPromptMarker(items, 'message-history'),
  // The history trails every prompt when unmarked
  'message-history': () => -1,
}

/** Whether the leading system block absorbs `item` instead of ending at it. */
function extendsSystemBlock(item: PromptItem): boolean {
  return isPromptMarker(item)
    ? item.type === 'agent-prompts'
    : item.role === 'system'
}
