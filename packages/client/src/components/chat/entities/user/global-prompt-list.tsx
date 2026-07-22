import { PromptList } from '@/components/chat/prompts'
import { newPrompt } from '@/lib/chat'
import type { OrderedItem, Prompt } from '@/lib/chat'
import { promptItemKey } from '@sb/convex/model/prompt/markers'

type GlobalPromptListProps = {
  prompts: Prompt[]
  onChange: (prompts: Prompt[]) => void
}

export function GlobalPromptList({ prompts, onChange }: GlobalPromptListProps) {
  const items = prompts.map((p) => ({
    item: p,
    isGlobal: false as const,
  }))

  function handleReorder(order: OrderedItem[]) {
    const reordered = order
      .map((ref) => prompts.find((p) => promptItemKey(p) === ref.id))
      .filter((p): p is Prompt => p !== undefined)
    onChange(reordered)
  }

  function handleAdd() {
    onChange([...prompts, newPrompt()])
  }

  function handlePaste(data: Omit<Prompt, 'id'>) {
    onChange([...prompts, newPrompt(data)])
  }

  function handleEdit(id: string, data: Partial<Prompt>) {
    onChange(prompts.map((p) => (p.id === id ? { ...p, ...data } : p)))
  }

  function handleDelete(id: string) {
    onChange(prompts.filter((p) => p.id !== id))
  }

  return (
    <PromptList
      items={items}
      onReorder={handleReorder}
      onAdd={handleAdd}
      onPaste={handlePaste}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  )
}
