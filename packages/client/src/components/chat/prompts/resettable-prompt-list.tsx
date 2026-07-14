import { ConfirmDialog, RippleButton } from '@/components/ui'
import { newPrompt } from '@/lib/chat'
import type { OrderedItem, Prompt, PromptItem } from '@/lib/chat'
import { RotateCcwIcon } from 'lucide-react'

import { PromptList } from './prompt-list'

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
  const items = prompts.map((item) => ({
    item,
    isGlobal: false as const,
  }))

  function handleReorder(order: OrderedItem[]) {
    const reordered = order
      .map((ref) => prompts.find((item) => item.id === ref.id))
      .filter((item): item is PromptItem => item !== undefined)
    onChange(reordered)
  }

  function handleAdd() {
    onChange([...prompts, newPrompt()])
  }

  function handlePaste(data: Omit<Prompt, 'id'>) {
    onChange([...prompts, newPrompt(data)])
  }

  function handleEdit(id: string, data: Partial<Prompt>) {
    onChange(
      prompts.map((item) =>
        item.id === id && !('type' in item) ? { ...item, ...data } : item,
      ),
    )
  }

  function handleDelete(id: string) {
    onChange(prompts.filter((item) => item.id !== id || 'type' in item))
  }

  return (
    <PromptList
      items={items}
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
