import { MarkdownRenderer, md } from '@/components/markdown/renderer'
import {
  ConfirmDialog,
  Dialog,
  HelpDialogLabel,
  HelpPopoverLabel,
  Input,
  Label,
  NumberInput,
  RippleButton,
  Select,
  Switch,
} from '@/components/ui'
import type { ReminderPrompt } from '@/lib/chat'
import { reminderDraftKey, useEditorDraft } from '@/lib/chat/editor-draft-store'
import { formatMarkdown } from '@/lib/markdown/format'
import { PROMPT_CONTENT_GUIDE } from '@sb/core/interpreter/guide'
import { capitalize } from '@sb/core/utils/strings'
import { useEffect, useRef } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { PromptContentEditor } from './prompt-content-editor'

type FormValues = Pick<
  ReminderPrompt,
  'name' | 'role' | 'interval' | 'eager' | 'content'
>

function toFormValues(reminder: ReminderPrompt): FormValues {
  return {
    name: reminder.name,
    role: reminder.role,
    interval: reminder.interval,
    eager: reminder.eager ?? false,
    content: reminder.content,
  }
}

export type ReminderEditorProps = {
  reminder: ReminderPrompt
  onSave: (data: Partial<ReminderPrompt>) => void
  trigger?: React.ReactElement<Record<string, unknown>>
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}

export function ReminderEditor({
  reminder,
  onSave,
  trigger,
  open,
  onOpenChange,
  title = 'Edit Reminder',
}: ReminderEditorProps) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<FormValues>({ defaultValues: toFormValues(reminder) })

  const draft = useEditorDraft<FormValues>(reminderDraftKey(reminder.id))
  const restoredId = useRef<string | null>(null)
  const restored = useRef(false)

  // Recover an unsaved draft, keeping the stored reminder as the dirty baseline
  useEffect(() => {
    if (restoredId.current === reminder.id) return
    restoredId.current = reminder.id
    const saved = draft.read()
    restored.current = saved !== undefined
    if (saved) reset(saved, { keepDefaultValues: true })
  }, [reminder.id, draft, reset])

  const watched = useWatch({ control })
  useEffect(() => {
    if (isDirty) return draft.save(watched as FormValues)
    if (!restored.current) draft.clear()
  }, [watched, isDirty, draft])

  useEffect(() => {
    if (open || draft.read()) return
    reset(toFormValues(reminder))
  }, [reminder, open, reset, draft])

  function handleSave(values: FormValues) {
    const saved = {
      ...values,
      content: formatMarkdown(values.content),
      interval: Math.max(1, Math.round(values.interval)),
    }
    onSave(saved)
    restored.current = false
    reset(saved)
    draft.clear()
    onOpenChange(false)
  }

  function handleDiscard() {
    restored.current = false
    reset()
    draft.clear()
    onOpenChange(false)
  }

  function handleCancel(e: React.MouseEvent) {
    if (isDirty) {
      e.preventDefault()
      return
    }
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && isDirty) return
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      {trigger && <Dialog.Trigger render={trigger} />}
      <Dialog.Content
        showCloseButton={false}
        className="grid h-[calc(100svh-2rem)] max-h-180 max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
      >
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input {...register('name')} />
          </div>

          <div className="flex flex-row items-end gap-10">
            <div className="flex flex-col gap-2">
              <Label>Role</Label>
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <Select
                    value={capitalize(field.value)}
                    onValueChange={field.onChange}
                  >
                    <Select.Trigger variant="input">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="system">System</Select.Item>
                      <Select.Item value="user">User</Select.Item>
                      <Select.Item value="assistant">Assistant</Select.Item>
                    </Select.Content>
                  </Select>
                )}
              />
            </div>

            <div className="flex h-10 items-center gap-4">
              <HelpPopoverLabel
                help={md`
                  Inject the first reminder as soon as the session (or the
                  reminder) is new, instead of waiting for a full interval
                  to elapse first.
                `}
              >
                Eager
              </HelpPopoverLabel>
              <Controller
                name="eager"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={!!field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <HelpPopoverLabel help="Inject this reminder every N turns (messages).">
              Interval
            </HelpPopoverLabel>
            <Controller
              name="interval"
              control={control}
              render={({ field }) => (
                <NumberInput
                  value={field.value}
                  onChange={field.onChange}
                  minValue={1}
                  decimals={0}
                  className="w-42"
                />
              )}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <HelpDialogLabel
              title="Content Guide"
              help={<MarkdownRenderer>{PROMPT_CONTENT_GUIDE}</MarkdownRenderer>}
            >
              Content
            </HelpDialogLabel>
            <Controller
              name="content"
              control={control}
              render={({ field }) => (
                <PromptContentEditor
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Write your reminder…"
                />
              )}
            />
          </div>
        </div>

        <Dialog.Footer>
          <ConfirmDialog
            disabled={!isDirty}
            variant="destructive"
            title="Discard changes?"
            description="You have unsaved changes that will be lost."
            confirmText="Discard"
            cancelText="Keep editing"
            onConfirm={handleDiscard}
            className="z-55"
          >
            <RippleButton variant="input" onClick={handleCancel}>
              Cancel
            </RippleButton>
          </ConfirmDialog>
          <RippleButton onClick={(e) => void handleSubmit(handleSave)(e)}>
            Save
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}
