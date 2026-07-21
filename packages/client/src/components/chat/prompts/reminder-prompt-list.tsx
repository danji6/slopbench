import {
  ConfirmDialog,
  RippleButton,
  SearchableList,
  Switch,
  TooltipButton,
} from '@/components/ui'
import { newReminderPrompt } from '@/lib/chat'
import type { ReminderPrompt } from '@/lib/chat'
import { cn } from '@/lib/utils'
import {
  BookmarkIcon,
  ClipboardPasteIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { useReminderClipboard } from './reminder-clipboard'
import { ReminderEditor } from './reminder-editor'

type ReminderListItem = ReminderPrompt & { isLibrary?: boolean }

type ReminderPromptListProps = {
  reminders: ReminderPrompt[]
  onChange: (reminders: ReminderPrompt[]) => void
  /** Read-only reminders referenced from the user's library. */
  libraryItems?: ReminderPrompt[]
  onRemoveLibrary?: (id: string) => void
  extraButtons?: ReactNode
  /** Off in the library, where agents opt in by referencing a reminder. */
  showEnabledSwitch?: boolean
}

export function ReminderPromptList({
  reminders,
  onChange,
  libraryItems = [],
  onRemoveLibrary,
  extraButtons,
  showEnabledSwitch = true,
}: ReminderPromptListProps) {
  const [editing, setEditing] = useState<ReminderPrompt | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const { copy, pasteData } = useReminderClipboard()

  const isExisting = !!editing && reminders.some((r) => r.id === editing.id)

  const items: ReminderListItem[] = [
    ...libraryItems.map((r) => ({ ...r, isLibrary: true })),
    ...reminders,
  ]

  function handleAdd() {
    setEditing(newReminderPrompt({ name: 'New Reminder' }))
  }

  function handlePaste() {
    if (!pasteData) return
    onChange([newReminderPrompt(pasteData), ...reminders])
  }

  function handleSave(data: Partial<ReminderPrompt>) {
    if (!editing) return
    onChange(
      isExisting
        ? reminders.map((r) => (r.id === editing.id ? { ...r, ...data } : r))
        : [{ ...editing, ...data }, ...reminders],
    )
  }

  function handleToggle(id: string, enabled: boolean) {
    onChange(reminders.map((r) => (r.id === id ? { ...r, enabled } : r)))
  }

  function handleDelete(id: string) {
    onChange(reminders.filter((r) => r.id !== id))
    setDeleteId(null)
  }

  return (
    <>
      <SearchableList<ReminderListItem>
        items={items}
        keys={(r) => r.id}
        fields={['name', 'content']}
        pageSize={10}
        searchPlaceholder="Search reminders..."
        actions={
          <div className="flex items-center gap-1">
            {extraButtons}
            <RippleButton
              size="sm"
              variant="input"
              disabled={!pasteData}
              onClick={handlePaste}
            >
              <ClipboardPasteIcon />
              Paste
            </RippleButton>
            <RippleButton size="sm" variant="input" onClick={handleAdd}>
              <PlusIcon />
              Add
            </RippleButton>
          </div>
        }
        empty={() => (
          <div className="text-muted-foreground p-2 text-center text-xs">
            No reminders yet
          </div>
        )}
        className="flex flex-col gap-2"
        itemProps={{ className: 'w-full' }}
        render={(r) => (
          <div
            className={cn(
              'bg-m3-surface-container-low border-input flex w-full items-center gap-0.5 rounded-full border py-1.5 pr-1.5 pl-5',
              r.isLibrary && 'bg-muted border-dashed opacity-60',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
            <span className="text-muted-foreground mr-2 text-xs capitalize">
              {r.role}
            </span>
            <span className="text-muted-foreground mr-2 text-xs whitespace-nowrap">
              every {r.interval} {r.interval === 1 ? 'turn' : 'turns'}
            </span>
            {r.isLibrary ? (
              <>
                <BookmarkIcon className="text-muted-foreground/80 mr-1 size-5" />
                <TooltipButton
                  tooltip="Remove"
                  size="icon"
                  variant="stealth"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onRemoveLibrary?.(r.id)}
                >
                  <Trash2Icon />
                </TooltipButton>
              </>
            ) : (
              <>
                {showEnabledSwitch && (
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => handleToggle(r.id, v)}
                    className="mr-1"
                  />
                )}
                <TooltipButton
                  tooltip="Copy"
                  size="icon"
                  variant="stealth"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => copy(r)}
                >
                  <CopyIcon />
                </TooltipButton>
                <RippleButton
                  size="icon"
                  variant="stealth"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setEditing(r)}
                >
                  <PencilIcon />
                </RippleButton>
                <RippleButton
                  size="icon"
                  variant="stealth"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteId(r.id)}
                >
                  <Trash2Icon />
                </RippleButton>
              </>
            )}
          </div>
        )}
      />
      {editing && (
        <ReminderEditor
          key={editing.id}
          reminder={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSave={handleSave}
          title={isExisting ? 'Edit Reminder' : 'New Reminder'}
        />
      )}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Delete reminder?"
        description="Already injected reminders stay in their sessions. This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deleteId && handleDelete(deleteId)}
      />
    </>
  )
}
