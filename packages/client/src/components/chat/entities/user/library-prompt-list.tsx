import { PromptEditor } from '@/components/chat/prompts'
import {
  ConfirmDialog,
  RippleButton,
  SearchableList,
  TooltipButton,
} from '@/components/ui'
import { newPrompt } from '@/lib/chat'
import type { Prompt } from '@/lib/chat'
import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { LibraryPrompt } from './settings-schema'

type LibraryPromptListProps = {
  prompts: LibraryPrompt[]
  onChange: (prompts: LibraryPrompt[]) => void
}

export function LibraryPromptList({
  prompts,
  onChange,
}: LibraryPromptListProps) {
  const [editing, setEditing] = useState<LibraryPrompt | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...prompts].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [prompts],
  )

  const isExisting = !!editing && prompts.some((p) => p.id === editing.id)

  function handleAdd() {
    setEditing({ ...newPrompt({ name: 'New Prompt' }), createdAt: Date.now() })
  }

  function handleSave(data: Partial<Prompt>) {
    if (!editing) return
    onChange(
      isExisting
        ? prompts.map((p) => (p.id === editing.id ? { ...p, ...data } : p))
        : [{ ...editing, ...data }, ...prompts],
    )
  }

  function handleDelete(id: string) {
    onChange(prompts.filter((p) => p.id !== id))
    setDeleteId(null)
  }

  function handleDuplicate(prompt: LibraryPrompt) {
    onChange([
      {
        ...newPrompt({
          name: getDuplicateName(prompt.name, prompts),
          role: prompt.role,
          content: prompt.content,
          enabled: prompt.enabled,
          visible: prompt.visible,
          starter: prompt.starter,
        }),
        createdAt: getNextCreatedAt(prompts),
      },
      ...prompts,
    ])
  }

  return (
    <>
      <SearchableList<LibraryPrompt>
        items={sorted}
        keys={(p) => p.id}
        fields={['name', 'content']}
        pageSize={10}
        searchPlaceholder="Search prompts..."
        actions={
          <RippleButton size="sm" variant="input" onClick={handleAdd}>
            <PlusIcon />
            Add
          </RippleButton>
        }
        empty={() => (
          <div className="text-muted-foreground p-2 text-center text-xs">
            No prompts yet
          </div>
        )}
        className="flex flex-col gap-2"
        itemProps={{ className: 'w-full' }}
        render={(p) => (
          <div className="bg-m3-surface-container-low border-input flex w-full items-center gap-0.5 rounded-full border py-1.5 pr-1.5 pl-5">
            <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
            <span className="text-muted-foreground mr-2 text-xs capitalize">
              {p.role}
            </span>
            <TooltipButton
              tooltip="Duplicate"
              size="icon"
              variant="stealth"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => handleDuplicate(p)}
            >
              <CopyIcon />
            </TooltipButton>
            <RippleButton
              size="icon"
              variant="stealth"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(p)}
            >
              <PencilIcon />
            </RippleButton>
            <RippleButton
              size="icon"
              variant="stealth"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteId(p.id)}
            >
              <Trash2Icon />
            </RippleButton>
          </div>
        )}
      />
      {editing && (
        <PromptEditor
          key={editing.id}
          prompt={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSave={handleSave}
          title={isExisting ? 'Edit Prompt' : 'New Prompt'}
        />
      )}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Delete prompt?"
        description="Agents using this prompt will lose it. This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deleteId && handleDelete(deleteId)}
      />
    </>
  )
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getDuplicateName(name: string, prompts: LibraryPrompt[]) {
  const pattern = new RegExp(`^${escapeRegex(name)} (\\d+)$`)
  const indexes = prompts
    .map((p) => p.name.match(pattern)?.[1])
    .filter((index): index is string => index !== undefined)
    .map(Number)

  return `${name} ${Math.max(0, ...indexes) + 1}`
}

function getNextCreatedAt(prompts: LibraryPrompt[]) {
  return Math.max(0, ...prompts.map((p) => p.createdAt ?? 0)) + 1
}
