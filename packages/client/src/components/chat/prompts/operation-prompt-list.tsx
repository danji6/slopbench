import {
  ConfirmDialog,
  RippleButton,
  Switch,
  TooltipButton,
} from '@/components/ui'
import {
  type SortableHandleProps,
  SortableList,
} from '@/components/ui/sortable-list'
import { useOperationPromptEditorView } from '@/hooks/chat/prompt-editor'
import type { Prompt } from '@/lib/chat'
import { getEditorDraft, promptDraftKey } from '@/lib/chat/editor-draft-store'
import { newPrompt } from '@/lib/chat/prompts'
import { normalizeOperationPrompt } from '@sb/core/prompts'
import {
  ClipboardPasteIcon,
  CopyIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { usePromptClipboard } from './prompt-clipboard'
import { PromptEditor } from './prompt-editor'

type OperationPromptListProps = {
  prompts: Prompt[]
  onChange: (prompts: Prompt[]) => void
  kind: 'compaction' | 'impersonation'
  createDefaults: () => Prompt[]
}

/** Edits the ordered instructions appended to an operation's request. */
export function OperationPromptList({
  prompts,
  onChange,
  kind,
  createDefaults,
}: OperationPromptListProps) {
  const view = useOperationPromptEditorView(kind)
  const [added, setAdded] = useState<Prompt | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const { copy, pasteData } = usePromptClipboard()
  const editingId = view.value
  const isExisting = prompts.some((p) => p.id === editingId)

  const editing = useMemo(() => {
    if (!editingId) return null
    const stored = prompts.find((p) => p.id === editingId)
    if (stored) return stored
    if (added?.id === editingId) return added
    const draft = getEditorDraft<unknown>(promptDraftKey(editingId))
    return draft ? newPrompt({ name: 'New Prompt', id: editingId }) : null
  }, [editingId, prompts, added])

  function handleAdd() {
    const prompt = newPrompt({ name: 'New Prompt' })
    setAdded(prompt)
    view.open(prompt.id)
  }

  function handleSave(data: Partial<Prompt>) {
    if (!editing) return
    const saved = normalizeOperationPrompt({ ...editing, ...data })
    onChange(
      isExisting
        ? prompts.map((p) => (p.id === saved.id ? saved : p))
        : [...prompts, saved],
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-1">
        <ConfirmDialog
          variant="destructive"
          title={`Reset ${kind} prompts?`}
          description={`This will replace your ${kind} prompts with the default prompts.`}
          confirmText="Reset"
          onConfirm={() => onChange(createDefaults())}
        >
          <RippleButton size="sm" variant="input">
            <RotateCcwIcon />
            Reset
          </RippleButton>
        </ConfirmDialog>
        <RippleButton
          size="sm"
          variant="input"
          disabled={!pasteData}
          onClick={() =>
            pasteData &&
            onChange([
              ...prompts,
              normalizeOperationPrompt(newPrompt(pasteData)),
            ])
          }
        >
          <ClipboardPasteIcon />
          Paste
        </RippleButton>
        <RippleButton size="sm" variant="input" onClick={handleAdd}>
          <PlusIcon />
          Add
        </RippleButton>
      </div>
      <SortableList
        items={prompts}
        keys={(p) => p.id}
        onReorder={onChange}
        className="flex flex-col gap-2"
        render={(prompt, _index, handleProps) => (
          <OperationPromptRow
            prompt={prompt}
            handleProps={handleProps}
            onToggle={(enabled) =>
              onChange(
                prompts.map((p) =>
                  p.id === prompt.id ? { ...p, enabled } : p,
                ),
              )
            }
            onCopy={() => copy(prompt)}
            onEdit={() => view.open(prompt.id)}
            onDelete={() => setDeleteId(prompt.id)}
          />
        )}
      />
      {prompts.length === 0 && (
        <p className="text-muted-foreground p-2 text-center text-xs">
          No prompts. Saving an empty list restores inherited prompts or
          built-in defaults.
        </p>
      )}
      {editing && (
        <PromptEditor
          key={editing.id}
          prompt={editing}
          open
          onOpenChange={(open) => !open && view.close()}
          onSave={handleSave}
          showVisibleSwitch={false}
          title={isExisting ? 'Edit Prompt' : 'New Prompt'}
        />
      )}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete prompt?"
        description="This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          onChange(prompts.filter((p) => p.id !== deleteId))
          setDeleteId(null)
        }}
      />
    </div>
  )
}

function OperationPromptRow({
  prompt,
  handleProps,
  onToggle,
  onCopy,
  onEdit,
  onDelete,
}: {
  prompt: Prompt
  handleProps: SortableHandleProps
  onToggle: (enabled: boolean) => void
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="bg-m3-surface-container-low border-input flex w-full items-center gap-0.5 rounded-full border py-1.5 pr-1.5 pl-2">
      <button
        type="button"
        {...handleProps}
        aria-label={`Reorder ${prompt.name}`}
        className="text-muted-foreground mr-2 flex size-8 shrink-0 items-center justify-center"
      >
        <GripVerticalIcon />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm">{prompt.name}</span>
      <span className="text-muted-foreground mr-2 text-xs capitalize">
        {prompt.role}
      </span>
      <Switch
        checked={prompt.enabled}
        onCheckedChange={onToggle}
        aria-label={`Enable ${prompt.name}`}
        className="mr-1"
      />
      <TooltipButton
        tooltip="Copy"
        aria-label={`Copy ${prompt.name}`}
        size="icon"
        variant="stealth"
        onClick={onCopy}
      >
        <CopyIcon />
      </TooltipButton>
      <TooltipButton
        tooltip="Edit"
        aria-label={`Edit ${prompt.name}`}
        size="icon"
        variant="stealth"
        onClick={onEdit}
      >
        <PencilIcon />
      </TooltipButton>
      <TooltipButton
        tooltip="Delete"
        aria-label={`Delete ${prompt.name}`}
        size="icon"
        variant="stealth"
        onClick={onDelete}
      >
        <Trash2Icon />
      </TooltipButton>
    </div>
  )
}
