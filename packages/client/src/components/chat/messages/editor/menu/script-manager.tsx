import { type IconName, IconPicker } from '@/components/icon-picker'
import { MarkdownRenderer } from '@/components/markdown'
import {
  CodeEditor,
  Dialog,
  HelpDialogLabel,
  Input,
  InsetDrawer,
  RippleButton,
  SettingsFooter,
  Surface,
  Toggle,
} from '@/components/ui'
import type { SortableHandleProps } from '@/components/ui/sortable-list'
import { SortableList } from '@/components/ui/sortable-list'
import { useBreakpoint } from '@/hooks'
import { useScripts } from '@/hooks/chat/scripts'
import { cn, generateId } from '@/lib/utils'
import {
  GripVerticalIcon,
  PanelLeftOpenIcon,
  PinIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { SCRIPT_COMPLETIONS } from '../script-completions'

type ScriptManagerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ScriptItem = {
  id: string
  name: string
  code: string
  icon: string
  pinned: boolean
}

type ScriptFormValues = {
  scripts: ScriptItem[]
}

function isNewId(id: string) {
  return id.startsWith('new:')
}

function scriptChanged(a: ScriptItem, b: ScriptItem) {
  return (
    a.name !== b.name ||
    a.code !== b.code ||
    a.icon !== b.icon ||
    a.pinned !== b.pinned
  )
}

export function ScriptManager({ open, onOpenChange }: ScriptManagerProps) {
  const { scripts, loaded, createScript, updateScript, deleteScript } =
    useScripts()

  const form = useForm<ScriptFormValues>({ defaultValues: { scripts: [] } })
  const items = useWatch({ control: form.control, name: 'scripts' }) ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIndex = items.findIndex((s) => s.id === selectedId)
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null

  const isMobile = useBreakpoint('sm')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Snapshot of the persisted scripts at init time, used to diff on save
  const [initial, setInitial] = useState<ScriptItem[]>([])
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      return
    }
    if (initialized.current || !loaded) return
    const mapped: ScriptItem[] = scripts.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      icon: s.icon,
      pinned: s.pinned,
    }))
    form.reset({ scripts: mapped })
    setInitial(mapped)
    initialized.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, scripts])

  const isDirty = form.formState.isDirty

  function setItem(index: number, patch: Partial<ScriptItem>) {
    const current = form.getValues('scripts')
    const next = current.map((s, i) => (i === index ? { ...s, ...patch } : s))
    form.setValue('scripts', next, { shouldDirty: true })
  }

  function handleNew() {
    const item: ScriptItem = {
      id: `new:${generateId()}`,
      name: 'New script',
      code: 'return text',
      icon: 'scroll-text',
      pinned: false,
    }
    form.setValue('scripts', [...form.getValues('scripts'), item], {
      shouldDirty: true,
    })
    handleSelect(item.id)
  }

  function handleSelect(id: string) {
    setSelectedId(id)
    setDrawerOpen(false)
  }

  function handleDelete(id: string) {
    form.setValue(
      'scripts',
      form.getValues('scripts').filter((s) => s.id !== id),
      { shouldDirty: true },
    )
    if (selectedId === id) setSelectedId(null)
  }

  function handleReorder(reordered: ScriptItem[]) {
    form.setValue('scripts', reordered, { shouldDirty: true })
  }

  async function persist(values: ScriptFormValues) {
    const original = initial
    const originalById = new Map(original.map((s) => [s.id, s]))
    const originalIndexById = new Map(original.map((s, i) => [s.id, i]))
    const currentIds = new Set(values.scripts.map((s) => s.id))

    for (const s of original) {
      if (!currentIds.has(s.id)) await deleteScript(s.id)
    }

    const resolved: ScriptItem[] = []
    for (const [index, s] of values.scripts.entries()) {
      const orig = originalById.get(s.id)
      if (!orig || isNewId(s.id)) {
        const created = await createScript({
          name: s.name,
          code: s.code,
          icon: s.icon,
          pinned: s.pinned,
          order: index,
        })
        resolved.push({ ...s, id: created.id })
        if (selectedId === s.id) setSelectedId(created.id)
      } else {
        const moved = originalIndexById.get(s.id) !== index
        if (scriptChanged(orig, s) || moved) {
          await updateScript(s.id, {
            name: s.name,
            code: s.code,
            icon: s.icon,
            pinned: s.pinned,
            order: index,
          })
        }
        resolved.push(s)
      }
    }

    setInitial(resolved)
    form.reset({ scripts: resolved })
  }

  function handleClose() {
    onOpenChange(false)
  }

  function handleDiscard() {
    form.reset()
    setSelectedId(null)
    handleClose()
  }

  function handleOpenChange(next: boolean) {
    if (!next && isDirty) return
    onOpenChange(next)
  }

  const apply = form.handleSubmit(persist)
  const save = form.handleSubmit(async (values) => {
    await persist(values)
    handleClose()
  })

  const sidebar = (
    <ScriptSidebar
      items={items}
      selectedId={selectedId}
      onSelect={handleSelect}
      onDelete={handleDelete}
      onReorder={handleReorder}
      onNew={handleNew}
    />
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content
        className="flex h-120 max-w-2xl flex-col gap-0 p-0"
        showCloseButton={false}
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={apply}>
          <Dialog.Header className="border-b px-4 py-3">
            <Dialog.Title className="text-md font-semibold">
              <ScriptHelp />
            </Dialog.Title>
            <Dialog.Description className="text-muted-foreground text-sm">
              Manage your scripts.
            </Dialog.Description>
          </Dialog.Header>
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {isMobile ? (
              <InsetDrawer
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                className="w-45"
              >
                {sidebar}
              </InsetDrawer>
            ) : (
              <div className="flex w-45 flex-col border-r">{sidebar}</div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
              {isMobile && (
                <RippleButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => setDrawerOpen(true)}
                >
                  <PanelLeftOpenIcon className="size-4" />
                  Scripts
                </RippleButton>
              )}
              {selected ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      value={selected.name}
                      onChange={(e) =>
                        setItem(selectedIndex, { name: e.target.value })
                      }
                      placeholder="Script name"
                      className="h-8 flex-1 text-sm"
                    />
                    <IconPicker
                      value={selected.icon as IconName}
                      onValueChange={(icon) => setItem(selectedIndex, { icon })}
                      side="bottom"
                    />
                    <Toggle
                      pressed={selected.pinned}
                      onPressedChange={(pinned) =>
                        setItem(selectedIndex, { pinned })
                      }
                      className="size-8"
                      title={
                        selected.pinned
                          ? 'Unpin from toolbar'
                          : 'Pin to toolbar'
                      }
                    >
                      <PinIcon className="size-3.5" />
                    </Toggle>
                  </div>
                  <CodeEditor
                    value={selected.code}
                    onChange={(code) => setItem(selectedIndex, { code })}
                    language="javascript"
                    placeholder="return text.toUpperCase()"
                    completions={SCRIPT_COMPLETIONS}
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-muted-foreground text-sm">
                    Select a script to edit
                  </p>
                </div>
              )}
            </div>
          </div>
          <SettingsFooter
            isDirty={isDirty}
            onClose={handleClose}
            onDiscard={handleDiscard}
            onSave={save}
          />
        </form>
      </Dialog.Content>
    </Dialog>
  )
}

function ScriptSidebar({
  items,
  selectedId,
  onSelect,
  onDelete,
  onReorder,
  onNew,
}: {
  items: ScriptItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onReorder: (items: ScriptItem[]) => void
  onNew: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <SortableList<ScriptItem>
          items={items}
          keys={(script) => script.id}
          onReorder={onReorder}
          render={(script, _index, handleProps) => (
            <ScriptListItem
              key={script.id}
              script={script}
              isSelected={script.id === selectedId}
              handleProps={handleProps}
              onSelect={() => onSelect(script.id)}
              onDelete={() => onDelete(script.id)}
            />
          )}
        />
        {items.length === 0 && (
          <p className="text-muted-foreground px-3 py-4 text-xs">
            No scripts yet.
          </p>
        )}
      </div>
      <div className="border-t">
        <RippleButton
          type="button"
          variant="stealth"
          className="w-full rounded-none"
          onClick={onNew}
        >
          <PlusIcon className="size-3.5" />
          New
        </RippleButton>
      </div>
    </div>
  )
}

function ScriptListItem({
  script,
  isSelected,
  handleProps,
  onSelect,
  onDelete,
}: {
  script: ScriptItem
  isSelected: boolean
  handleProps: SortableHandleProps
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <Surface
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-none border-0 border-b py-2 pr-2 pl-1 text-sm',
        isSelected && 'bg-m3-surface-container',
      )}
      onClick={onSelect}
    >
      <button
        type="button"
        tabIndex={-1}
        className="text-muted-foreground/50 hover:text-muted-foreground flex h-6 shrink-0 items-center outline-0"
        onClick={(e) => e.stopPropagation()}
        {...handleProps}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {script.pinned && (
          <PinIcon className="text-muted-foreground size-3 shrink-0" />
        )}
        <span className="min-w-0 truncate">{script.name}</span>
      </div>
      <RippleButton
        type="button"
        variant="stealth"
        size="icon"
        className="text-muted-foreground/70 size-6 shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2Icon className="size-3.5" />
      </RippleButton>
    </Surface>
  )
}

const scriptHelpMarkdown = `
A script transforms your selected text. Whatever string you return replaces the selection:

\`\`\`js
return text.toUpperCase()
\`\`\`

**Variables**

- \`text\` — the selected text
- \`paragraph\` — the paragraph the selection is in
- \`message\` — the entire message
- \`editor\` — the TipTap editor instance (advanced)

**Editing beyond the selection**

Return one of these helpers to target something other than the selection:
- \`replaceParagraph(value)\` / \`deleteParagraph()\`
- \`replaceMessage(value)\` / \`deleteMessage()\`
- \`replaceToEnd(value)\` / \`deleteToEnd()\` (from the selection to the end)
- \`replaceToStart(value)\` / \`deleteToStart()\` (from the start to the selection)
- \`replaceSelection(value)\` / \`deleteSelection()\`

**Examples**

Delete the current paragraph:

\`\`\`js
return deleteParagraph()
\`\`\`

Replace every occurrence in the message:

\`\`\`js
return replaceMessage(message.replaceAll('old', 'new'))
\`\`\`

Delete everything from the selection to the end:

\`\`\`js
return deleteToEnd()
\`\`\`
`.trim()

function ScriptHelp() {
  return (
    <HelpDialogLabel
      title="Script Guide"
      help={<MarkdownRenderer>{scriptHelpMarkdown}</MarkdownRenderer>}
    >
      Script Manager
    </HelpDialogLabel>
  )
}
