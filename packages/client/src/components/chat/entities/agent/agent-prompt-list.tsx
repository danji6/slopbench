import { AddFromLibrary, PromptList } from '@/components/chat/prompts'
import { useSettings } from '@/hooks/chat'
import type { OrderedItem, Prompt } from '@/lib/chat'
import { mergePrompts, newPrompt } from '@/lib/chat/prompts'
import type { MergedPromptItem } from '@/lib/chat/prompts'
import { useEffect } from 'react'
import type { Control, UseFormSetValue } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

type AgentPromptListProps = {
  control: Control<AgentFormValues>
  setValue: UseFormSetValue<AgentFormValues>
}

function toOrderedItem(m: MergedPromptItem): OrderedItem {
  if (m.isLibrary) return { kind: 'library', id: m.item.id }
  if (m.isGlobal) return { kind: 'global', id: m.item.id }
  return { kind: 'own', id: m.item.id }
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

  function handleAdd(data?: Omit<Prompt, 'id'>) {
    const prompt = newPrompt(data)
    promptsField.onChange([...prompts, prompt])
    if (promptOrder) {
      orderField.onChange([
        ...promptOrder,
        { kind: 'own' as const, id: prompt.id },
      ])
    }
  }

  function handleAddLibrary(id: string) {
    const order = promptOrder ?? mergeResult.items.map(toOrderedItem)
    orderField.onChange([...order, { kind: 'library' as const, id }])
  }

  function handleEdit(id: string, data: Partial<Prompt>) {
    promptsField.onChange(
      prompts.map((p) => (p.id === id ? { ...p, ...data } : p)),
    )
  }

  function handleDelete(id: string) {
    promptsField.onChange(prompts.filter((p) => p.id !== id))
    if (promptOrder) {
      orderField.onChange(promptOrder.filter((ref) => ref.id !== id))
    }
  }

  return (
    <PromptList
      items={mergeResult.items}
      onReorder={handleReorder}
      onAdd={handleAdd}
      onPaste={handleAdd}
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
