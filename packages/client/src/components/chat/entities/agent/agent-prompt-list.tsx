import { AddFromLibrary, PromptList } from '@/components/chat/prompts'
import { useSettings } from '@/hooks/chat'
import type { OrderedItem, Prompt, PromptItem } from '@/lib/chat'
import { mergePrompts, newPrompt, upsertPrompt } from '@/lib/chat/prompts'
import type { MergedPromptItem } from '@/lib/chat/prompts'
import {
  ensurePromptMarkers,
  promptItemKey,
} from '@sb/convex/model/prompt/markers'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { AGENT_PROMPT_MARKERS, type AgentFormValues } from './agent-form'

type AgentPromptListProps = {
  control: Control<AgentFormValues>
}

function toOrderedItem(m: MergedPromptItem): OrderedItem {
  const id = promptItemKey(m.item)
  if (m.isLibrary) return { kind: 'library', id }
  if (m.isGlobal) return { kind: 'global', id }
  return { kind: 'own', id }
}

export function AgentPromptList({ control }: AgentPromptListProps) {
  const settings = useSettings()
  const globalPrompts = settings?.globalPrompts ?? []
  const libraryPrompts = (settings?.libraryPrompts ?? []) as Prompt[]

  const { field: promptsField } = useController({ control, name: 'prompts' })
  const { field: orderField } = useController({ control, name: 'promptOrder' })
  const globalPromptsEnabled = useWatch({
    control,
    name: 'globalPromptsEnabled',
  })

  // Display-only normalisation
  const prompts = ensurePromptMarkers(promptsField.value, AGENT_PROMPT_MARKERS)
  const promptOrder = orderField.value

  const mergeResult = mergePrompts(
    { globalPromptsEnabled, prompts, promptOrder: promptOrder ?? undefined },
    globalPrompts,
    libraryPrompts,
  )

  const referencedLibraryIds = new Set(
    (promptOrder ?? [])
      .filter((ref) => ref.kind === 'library')
      .map((ref) => ref.id),
  )
  const availableLibrary = libraryPrompts.filter(
    (p) => !referencedLibraryIds.has(p.id),
  )

  function handleReorder(order: OrderedItem[]) {
    orderField.onChange(order)
  }

  function handleAddItem(item: PromptItem) {
    promptsField.onChange([...prompts, item])
    if (promptOrder) {
      orderField.onChange([
        ...promptOrder,
        { kind: 'own' as const, id: promptItemKey(item) },
      ])
    }
  }

  function handleAdd() {
    handleAddItem(newPrompt())
  }

  function handlePaste(data: Omit<Prompt, 'id'>) {
    handleAddItem(newPrompt(data))
  }

  function handleAddLibrary(id: string) {
    const order = promptOrder ?? mergeResult.items.map(toOrderedItem)
    orderField.onChange([...order, { kind: 'library' as const, id }])
  }

  function handleEdit(key: string, data: Partial<Prompt>) {
    const isNew = !prompts.some((p) => promptItemKey(p) === key)
    promptsField.onChange(upsertPrompt(prompts, key, data))
    if (isNew && promptOrder) {
      orderField.onChange([...promptOrder, { kind: 'own' as const, id: key }])
    }
  }

  function handleDelete(key: string) {
    promptsField.onChange(prompts.filter((p) => promptItemKey(p) !== key))
    if (promptOrder) {
      orderField.onChange(promptOrder.filter((ref) => ref.id !== key))
    }
  }

  return (
    <PromptList
      items={mergeResult.items}
      onReorder={handleReorder}
      onAdd={handleAdd}
      onPaste={handlePaste}
      onEdit={handleEdit}
      onDelete={handleDelete}
      extraButtons={
        libraryPrompts.length > 0 && (
          <AddFromLibrary
            items={availableLibrary}
            onSelect={handleAddLibrary}
          />
        )
      }
    />
  )
}
