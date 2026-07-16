import {
  ConfirmDialog,
  RippleButton,
  SearchableList,
  Switch,
  TooltipButton,
} from '@/components/ui'
import { newReminderPrompt } from '@/lib/chat'
import type { ReminderPrompt } from '@/lib/chat'
import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { ReminderEditor } from './reminder-editor'

type ReminderPromptListProps = {
  reminders: ReminderPrompt[]
  onChange: (reminders: ReminderPrompt[]) => void
}

export function ReminderPromptList({
  reminders,
  onChange,
}: ReminderPromptListProps) {
  const [editing, setEditing] = useState<ReminderPrompt | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const isExisting = !!editing && reminders.some((r) => r.id === editing.id)

  function handleAdd() {
    setEditing(newReminderPrompt({ name: 'New Reminder' }))
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

  function handleDuplicate(reminder: ReminderPrompt) {
    const { id: _, ...rest } = reminder
    onChange([
      newReminderPrompt({
        ...rest,
        name: getDuplicateName(reminder.name, reminders),
      }),
      ...reminders,
    ])
  }

  return (
    <>
      <SearchableList<ReminderPrompt>
        items={reminders}
        keys={(r) => r.id}
        fields={['name', 'content']}
        pageSize={10}
        searchPlaceholder="Search reminders..."
        actions={
          <RippleButton size="sm" variant="input" onClick={handleAdd}>
            <PlusIcon />
            Add
          </RippleButton>
        }
        empty={() => (
          <div className="text-muted-foreground p-2 text-center text-xs">
            No reminders yet
          </div>
        )}
        className="flex flex-col gap-2"
        itemProps={{ className: 'w-full' }}
        render={(r) => (
          <div className="bg-m3-surface-container-low border-input flex w-full items-center gap-0.5 rounded-full border py-1.5 pr-1.5 pl-5">
            <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
            <span className="text-muted-foreground mr-2 text-xs capitalize">
              {r.role}
            </span>
            <span className="text-muted-foreground mr-2 text-xs whitespace-nowrap">
              every {r.interval} {r.interval === 1 ? 'turn' : 'turns'}
            </span>
            <Switch
              checked={r.enabled}
              onCheckedChange={(v) => handleToggle(r.id, v)}
              className="mr-1"
            />
            <TooltipButton
              tooltip="Duplicate"
              size="icon"
              variant="stealth"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => handleDuplicate(r)}
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getDuplicateName(name: string, reminders: ReminderPrompt[]) {
  const pattern = new RegExp(`^${escapeRegex(name)} (\\d+)$`)
  const indexes = reminders
    .map((r) => r.name.match(pattern)?.[1])
    .filter((index): index is string => index !== undefined)
    .map(Number)

  return `${name} ${Math.max(0, ...indexes) + 1}`
}
