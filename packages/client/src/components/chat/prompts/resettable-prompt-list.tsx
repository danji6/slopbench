import { ConfirmDialog, RippleButton } from '@/components/ui'
import { newPrompt } from '@/lib/chat'
import type {
  OrderedItem,
  Prompt,
  PromptItem,
  PromptMarkerType,
} from '@/lib/chat'
import {
  ensurePromptMarkers,
  promptItemKey,
} from '@sb/convex/model/prompt/markers'
import { RotateCcwIcon } from 'lucide-react'

import { PromptList } from './prompt-list'

const MARKERS: PromptMarkerType[] = [
  'message-history',
  'agent-prompts',
  'system-boundary',
]

export type ResettablePromptListProps = {
  prompts: PromptItem[]
  onChange: (prompts: PromptItem[]) => void
  /** Lowercase noun for the reset dialog, e.g. "compaction". */
  kind: string
  createDefaults: () => PromptItem[]
}

export function ResettablePromptList({
  prompts,
  onChange,
  kind,
  createDefaults,
}: ResettablePromptListProps) {
  const items = ensurePromptMarkers(prompts, MARKERS)
  const merged = items.map((item) => ({
    item,
    isGlobal: false as const,
  }))

  function handleReorder(order: OrderedItem[]) {
    const reordered = order
      .map((ref) => items.find((item) => promptItemKey(item) === ref.id))
      .filter((item): item is PromptItem => item !== undefined)
    onChange(reordered)
  }

  function handleAdd() {
    onChange([...items, newPrompt()])
  }

  function handlePaste(data: Omit<Prompt, 'id'>) {
    onChange([...items, newPrompt(data)])
  }

  function handleEdit(key: string, data: Partial<Prompt>) {
    onChange(
      items.map((item) =>
        promptItemKey(item) === key && !('type' in item)
          ? { ...item, ...data }
          : item,
      ),
    )
  }

  function handleDelete(key: string) {
    onChange(items.filter((item) => promptItemKey(item) !== key))
  }

  return (
    <PromptList
      items={merged}
      onReorder={handleReorder}
      onAdd={handleAdd}
      onPaste={handlePaste}
      onEdit={handleEdit}
      onDelete={handleDelete}
      showVisibleSwitch={false}
      extraButtons={
        <ConfirmDialog
          variant="destructive"
          title={`Reset ${kind} prompts?`}
          description={`This will replace your ${kind} prompts with the default prompts.`}
          confirmText="Reset"
          onConfirm={() => onChange(createDefaults())}
        >
          <RippleButton size="sm" variant="link" className="text-m3-secondary">
            <RotateCcwIcon className="size-4" />
            Reset
          </RippleButton>
        </ConfirmDialog>
      }
    />
  )
}
