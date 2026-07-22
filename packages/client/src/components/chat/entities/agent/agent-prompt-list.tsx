import { AddFromLibrary, PromptList } from '@/components/chat/prompts'
import { useSettings } from '@/hooks/chat'
import type {
  OrderedItem,
  Prompt,
  PromptItem,
  PromptMarkerType,
} from '@/lib/chat'
import { mergePrompts, newPrompt } from '@/lib/chat/prompts'
import type { MergedPromptItem } from '@/lib/chat/prompts'
import { promptItemKey } from '@sb/convex/model/prompt/markers'
import { useEffect } from 'react'
import type { Control, UseFormSetValue } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

type AgentPromptListProps = {
  control: Control<AgentFormValues>
  setValue: UseFormSetValue<AgentFormValues>
}

const MARKERS: PromptMarkerType[] = ['message-history', 'system-boundary']

function toOrderedItem(m: MergedPromptItem): OrderedItem {
  const id = promptItemKey(m.item)
  if (m.isLibrary) return { kind: 'library', id }
  if (m.isGlobal) return { kind: 'global', id }
  return { kind: 'own', id }
}

export function AgentPromptList({ control, setValue }: AgentPromptListProps) {
  const settings = useSettings()
  const globalPrompts = settings?.globalPrompts ?? []
  const libraryPrompts = (settings?.libraryPrompts ?? []) as Prompt[]

  const { field: promptsField } = useController({ control, name: 'prompts' })
  const { field: orderField } = useController({ control, name: 'promptOrder' })
  const globalPromptsEnabled = useWatch({
    control,
    name: 'globalPromptsEnabled',
  })

  const prompts = promptsField.value
  const promptOrder = orderField.value

  const mergeResult = mergePrompts(
    { globalPromptsEnabled, prompts, promptOrder },
    globalPrompts,
    libraryPrompts,
  )

  useEffect(() => {
    if (mergeResult.cleanedOrder) {
      // Prompt merge operations don't count as user edits
      setValue('promptOrder', mergeResult.cleanedOrder, { shouldDirty: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeResult.cleanedOrder])

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

  function handleAdd(marker?: PromptMarkerType) {
    handleAddItem(marker ? { type: marker } : newPrompt())
  }

  function handlePaste(data: Omit<Prompt, 'id'>) {
    handleAddItem(newPrompt(data))
  }

  function handleAddLibrary(id: string) {
    const order = promptOrder ?? mergeResult.items.map(toOrderedItem)
    orderField.onChange([...order, { kind: 'library' as const, id }])
  }

  function handleEdit(key: string, data: Partial<Prompt>) {
    promptsField.onChange(
      prompts.map((p) => (promptItemKey(p) === key ? { ...p, ...data } : p)),
    )
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
      markers={MARKERS}
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
