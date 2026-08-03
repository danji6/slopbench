import { PromptEditor } from '@/components/chat/prompts'
import {
  ConfirmDialog,
  RippleButton,
  SearchableList,
  TooltipButton,
} from '@/components/ui'
import { useLibraryPromptEditorView } from '@/hooks/chat/prompt-editor'
import { newPrompt } from '@/lib/chat'
import type { Prompt } from '@/lib/chat'
import { getEditorDraft, promptDraftKey } from '@/lib/chat/editor-draft-store'
import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { LibraryPrompt } from './settings-schema'

type LibraryPromptListProps = {
  prompts: LibraryPrompt[]
  onChange: (prompts: LibraryPrompt[]) => void
}

/** Rebuilds a prompt from its local draft. */
function restoreFromDraft(id: string): LibraryPrompt | null {
  const saved = getEditorDraft<Partial<Prompt>>(promptDraftKey(id))
  if (!saved) return null
  return {
    ...newPrompt({ name: 'New Prompt' }),
    ...saved,
    id,
  }
}

export function LibraryPromptList({
  prompts,
  onChange,
}: LibraryPromptListProps) {
  const view = useLibraryPromptEditorView()
  const editingId = view.value ?? null
  const [added, setAdded] = useState<LibraryPrompt | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const isExisting = prompts.some((p) => p.id === editingId)

  const editing = useMemo<LibraryPrompt | null>(() => {
    if (!editingId) return null
    const stored = prompts.find((p) => p.id === editingId)
    if (stored) return stored
    if (added?.id === editingId) return added
    return restoreFromDraft(editingId)
  }, [editingId, prompts, added])

  function handleAdd() {
    const created = newPrompt({ name: 'New Prompt' })
    setAdded(created)
    view.open(created.id)
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
      newPrompt({
        name: getDuplicateName(prompt.name, prompts),
        role: prompt.role,
        content: prompt.content,
        enabled: prompt.enabled,
        visible: prompt.visible,
        starter: prompt.starter,
      }),
      ...prompts,
    ])
  }

  return (
    <>
      <SearchableList<LibraryPrompt>
        items={prompts}
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
              onClick={() => view.open(p.id)}
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
          onOpenChange={(o) => !o && view.close()}
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
