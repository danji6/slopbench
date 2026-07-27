import { MarkdownRenderer, md } from '@/components/markdown/renderer'
import {
  ConfirmDialog,
  Dialog,
  HelpDialogLabel,
  HelpPopoverLabel,
  Input,
  Label,
  RippleButton,
  Select,
  Switch,
} from '@/components/ui'
import type { Prompt } from '@/lib/chat'
import { promptDraftKey, useEditorDraft } from '@/lib/chat/editor-draft-store'
import { formatMarkdown } from '@/lib/markdown/format'
import { PROMPT_CONTENT_GUIDE } from '@sb/core/interpreter/guide'
import { capitalize } from '@sb/core/utils/strings'
import { useEffect, useRef } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { PromptContentEditor } from './prompt-content-editor'

type FormValues = Pick<
  Prompt,
  'name' | 'role' | 'content' | 'visible' | 'starter'
>

function toFormValues(prompt: Prompt): FormValues {
  return {
    name: prompt.name,
    role: prompt.role,
    content: prompt.content,
    visible: prompt.visible,
    starter: prompt.starter ?? false,
  }
}

export type PromptEditDialogProps = {
  prompt: Prompt
  onSave: (data: Partial<Prompt>) => void
  trigger?: React.ReactElement<Record<string, unknown>>
  open: boolean
  onOpenChange: (open: boolean) => void
  showVisibleSwitch?: boolean
  title?: string
}

export function PromptEditor({
  prompt,
  onSave,
  trigger,
  open,
  onOpenChange,
  showVisibleSwitch = true,
  title = 'Edit Prompt',
}: PromptEditDialogProps) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<FormValues>({ defaultValues: toFormValues(prompt) })
  const starter = useWatch({ control, name: 'starter' })

  const draft = useEditorDraft<FormValues>(promptDraftKey(prompt.id))
  const restoredId = useRef<string | null>(null)
  const restored = useRef(false)

  // Recover an unsaved draft, keeping the stored prompt as the dirty baseline
  useEffect(() => {
    if (restoredId.current === prompt.id) return
    restoredId.current = prompt.id
    const saved = draft.read()
    restored.current = saved !== undefined
    if (saved) reset(saved, { keepDefaultValues: true })
  }, [prompt.id, draft, reset])

  const watched = useWatch({ control })
  useEffect(() => {
    if (isDirty) return draft.save(watched as FormValues)
    if (!restored.current) draft.clear()
  }, [watched, isDirty, draft])

  useEffect(() => {
    if (open || draft.read()) return
    reset(toFormValues(prompt))
  }, [prompt, open, reset, draft])

  function handleSave(values: FormValues) {
    const saved = { ...values, content: formatMarkdown(values.content) }
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

          <div className="flex flex-row gap-12">
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

            {showVisibleSwitch && (
              <div className="flex h-full flex-wrap items-center gap-x-8 gap-y-3">
                <div className="flex items-center gap-4">
                  <HelpPopoverLabel help="Show this prompt in the chat header. Visual only, not persisted.">
                    Visible
                  </HelpPopoverLabel>
                  <Controller
                    name="visible"
                    control={control}
                    render={({ field }) => (
                      <Switch
                        checked={starter || !!field.value}
                        disabled={starter}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <HelpPopoverLabel
                    help={md`
                      Store this prompt as a normal message when a new session starts.

                      Only the first agent's starter prompts are used. After the session
                      is started, all starter prompts are ignored. Starter prompts are
                      inherently visible.
                    `}
                  >
                    Starter
                  </HelpPopoverLabel>
                  <Controller
                    name="starter"
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
            )}
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
                  fullscreenId="prompt"
                  placeholder="Write your prompt…"
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
