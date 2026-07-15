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
import { SESSION_ENV, SessionEnvEntry } from '@sb/core/interpreter/env'
import { capitalize } from '@sb/core/utils/strings'
import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { PromptContentEditor } from './prompt-content-editor'

type FormValues = Pick<
  Prompt,
  'name' | 'role' | 'content' | 'visible' | 'starter'
>

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
  } = useForm<FormValues>({
    defaultValues: {
      name: prompt.name,
      role: prompt.role,
      content: prompt.content,
      visible: prompt.visible,
      starter: prompt.starter ?? false,
    },
  })
  const starter = useWatch({ control, name: 'starter' })

  useEffect(() => {
    if (!open) {
      reset({
        name: prompt.name,
        role: prompt.role,
        content: prompt.content,
        visible: prompt.visible,
        starter: prompt.starter ?? false,
      })
    }
  }, [prompt, open, reset])

  function handleSave(values: FormValues) {
    onSave(values)
    onOpenChange(false)
  }

  function handleDiscard() {
    reset()
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
              help={<MarkdownRenderer>{contentGuide}</MarkdownRenderer>}
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
          <RippleButton onClick={handleSubmit(handleSave)}>Save</RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

const kindOf = (entry: SessionEnvEntry) =>
  entry.name.startsWith('$') ? 'function' : 'variable'

const envTableRows = SESSION_ENV.map(
  (entry) => `| \`${entry.name}\` | ${entry.description} | ${kindOf(entry)} |`,
).join('\n')

const fence = '` $``` `'

const contentGuide = `
You can write JavaScript code in the content of your prompts. Code is evaluated before sending a
message and the output replaces the block itself. This is useful when you want to inject dynamic
values into your prompts, like the current user's name, or values from previous messages.

To write a dynamic code block, type \`$\` followed by three backticks (${fence}):

\`\`\`js
function calculate() { ... }

// Get a value from the current session:
let value = $get('myValue')

if (!value) {
  // Store a value in the current session:
  value = calculate()
  $set('myValue', value)
}

return \`The result is \${value}\`
\`\`\`

Alternatively you can write inline code by wrapping your expression within double curly braces:
\`{{user ?? 'Bob'}}\`

**Supported variables and functions**

| Name | Description | Type |
|------|-------------|------|
${envTableRows}
`.trim()
