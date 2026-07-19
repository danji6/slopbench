import { ConfirmDialog, RippleButton } from '@/components/ui'
import { DropdownMenu } from '@/components/ui/dropdown-menu'
import type { SortableHandleProps } from '@/components/ui/sortable-list'
import { SortableList } from '@/components/ui/sortable-list'
import type { OrderedItem, Prompt } from '@/lib/chat'
import type { MergedPromptItem } from '@/lib/chat/prompts'
import { cn } from '@/lib/utils'
import { getPromptMarkerLabel } from '@sb/convex/model/prompt/markers'
import {
  BookmarkIcon,
  ClipboardPasteIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  GlobeIcon,
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { usePromptClipboard } from './prompt-clipboard'
import { PromptEditor } from './prompt-editor'

export type PromptListProps = {
  items: MergedPromptItem[]
  onReorder: (order: OrderedItem[]) => void
  onAdd: () => void
  onPaste: (data: Omit<Prompt, 'id'>) => void
  onEdit: (id: string, data: Partial<Prompt>) => void
  onDelete: (id: string) => void
  extraButtons?: ReactNode
  showVisibleSwitch?: boolean
}

export function PromptList({
  items,
  onReorder,
  onAdd,
  onPaste,
  onEdit,
  onDelete,
  extraButtons,
  showVisibleSwitch = true,
}: PromptListProps) {
  const [optimisticItems, setOptimisticItems] = useState(items)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [prevItems, setPrevItems] = useState(items)
  const { copy, pasteData } = usePromptClipboard()

  if (items !== prevItems) {
    setPrevItems(items)
    setOptimisticItems(items)
  }

  function handleReorder(reordered: MergedPromptItem[]) {
    setOptimisticItems(reordered)
    const order = reordered.map((m): OrderedItem => {
      if (m.isLibrary) return { kind: 'library', id: m.item.id }
      if (m.isGlobal) return { kind: 'global', id: m.item.id }
      return { kind: 'own', id: m.item.id }
    })
    onReorder(order)
  }

  function handleDelete(promptId: string) {
    setOptimisticItems((prev) => prev.filter((m) => m.item.id !== promptId))
    onDelete(promptId)
    setDeleteTargetId(null)
  }

  function handleEdit(promptId: string, data: Partial<Prompt>) {
    setOptimisticItems((prev) =>
      prev.map((m) =>
        m.item.id === promptId ? { ...m, item: { ...m.item, ...data } } : m,
      ),
    )
    onEdit(promptId, data)
  }

  return (
    <div className="flex flex-col gap-2">
      <SortableList<MergedPromptItem>
        items={optimisticItems}
        keys={(m) => m.item.id}
        onReorder={handleReorder}
        className="flex flex-col gap-2"
        render={(merged, _index, handleProps: SortableHandleProps) => (
          <PromptListItem
            key={merged.item.id}
            merged={merged}
            handleProps={handleProps}
            onCopy={() => copy(merged.item as Prompt)}
            onEdit={(data) => handleEdit(merged.item.id, data)}
            onDelete={() => setDeleteTargetId(merged.item.id)}
            onRemove={() => handleDelete(merged.item.id)}
            showVisibleSwitch={showVisibleSwitch}
          />
        )}
      />
      <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
        {extraButtons && (
          <div className="order-2 flex w-full justify-end gap-1 sm:order-1 sm:w-auto">
            {extraButtons}
          </div>
        )}
        <div className="order-1 flex w-full justify-end gap-1 sm:order-2 sm:w-auto">
          <RippleButton
            size="sm"
            variant="link"
            className="text-m3-secondary"
            disabled={!pasteData}
            onClick={() => pasteData && onPaste(pasteData)}
          >
            <ClipboardPasteIcon className="size-4" />
            Paste
          </RippleButton>
          <RippleButton
            size="sm"
            variant="link"
            className="text-m3-secondary"
            onClick={() => onAdd()}
          >
            Add
          </RippleButton>
        </div>
      </div>
      <ConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={(v) => !v && setDeleteTargetId(null)}
        title="Delete prompt?"
        description="This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => handleDelete(deleteTargetId!)}
      />
    </div>
  )
}

function PromptListItem({
  merged,
  handleProps,
  onCopy,
  onEdit,
  onDelete,
  onRemove,
  showVisibleSwitch,
}: {
  merged: MergedPromptItem
  handleProps: SortableHandleProps
  onCopy?: () => void
  onEdit?: (data: Partial<Prompt>) => void
  onDelete?: () => void
  onRemove?: () => void
  showVisibleSwitch: boolean
}) {
  const { item, isGlobal, isLibrary } = merged
  const [editOpen, setEditOpen] = useState(false)
  const isMarker = 'type' in item
  const isEditable = !isMarker && !isGlobal && !isLibrary
  const canCopy = !isMarker
  const hasMenu = isEditable || isLibrary
  const label = isMarker ? getPromptMarkerLabel(item.type) : item.name

  return (
    <div
      className={cn(
        'bg-m3-surface-container-low border-input flex w-fit max-w-full items-center gap-4 rounded-full border py-1 pl-2.5',
        hasMenu ? 'pr-1' : 'pr-5',
        !('enabled' in item) || item.enabled ? '' : 'opacity-50',
        (isGlobal || isLibrary || isMarker) &&
          'bg-muted border-dashed opacity-60',
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        className="text-muted-foreground h-8 outline-0"
        {...handleProps}
      >
        <GripVerticalIcon className="size-6" />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {isGlobal && !isMarker && (
        <GlobeIcon className="text-muted-foreground/80 size-5" />
      )}
      {isLibrary && !isMarker && (
        <BookmarkIcon className="text-muted-foreground/80 size-5" />
      )}
      {hasMenu && (
        <>
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <RippleButton
                  size="icon"
                  variant="stealth"
                  className="text-muted-foreground hover:text-foreground size-8"
                >
                  <EllipsisVerticalIcon />
                </RippleButton>
              }
            />
            <DropdownMenu.Content>
              {isEditable && (
                <DropdownMenu.Item onClick={() => setEditOpen(true)}>
                  <PencilIcon />
                  Edit
                </DropdownMenu.Item>
              )}
              {canCopy && (
                <DropdownMenu.Item onClick={onCopy}>
                  <CopyIcon />
                  Copy
                </DropdownMenu.Item>
              )}
              {isLibrary ? (
                <DropdownMenu.Item onClick={onRemove}>
                  <Trash2Icon />
                  Remove
                </DropdownMenu.Item>
              ) : (
                <>
                  <DropdownMenu.Item variant="destructive" onClick={onDelete}>
                    <Trash2Icon />
                    Delete
                  </DropdownMenu.Item>
                  {isEditable && (
                    <>
                      <DropdownMenu.Separator />
                      <DropdownMenu.CheckboxItem
                        checked={item.enabled}
                        onCheckedChange={(checked) =>
                          onEdit?.({ enabled: checked as boolean })
                        }
                      >
                        Enabled
                      </DropdownMenu.CheckboxItem>
                    </>
                  )}
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
          {isEditable && (
            <PromptEditor
              prompt={item as Prompt}
              onSave={onEdit!}
              open={editOpen}
              onOpenChange={setEditOpen}
              showVisibleSwitch={showVisibleSwitch}
            />
          )}
        </>
      )}
    </div>
  )
}
