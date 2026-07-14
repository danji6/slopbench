import { ConfirmDialog, DropdownMenu, RippleButton } from '@/components/ui'
import { Result } from '@/lib/result'
import {
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'

export type PickableRecord = { id: string; name: string }

export type EntityPickerContext<T extends PickableRecord> = {
  records: T[]
  active: T | null
  select: (id: string | null) => void
  create: () => Promise<T>
  delete: (id: string) => Promise<void>
  duplicate: (id: string) => Promise<T>
  export: (id: string) => Promise<void>
  import: (file: File) => Promise<T>
}

type EntityActionsMenuProps<T extends PickableRecord> = {
  context: EntityPickerContext<T>
  entityName: string
  accept?: string
  className?: string
}

/** CRUD actions for an entity: create, duplicate, import, export, delete. */
export function EntityActionsMenu<T extends PickableRecord>({
  context: ctx,
  entityName,
  accept = '.json',
  className,
}: EntityActionsMenuProps<T>) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteName, setDeleteName] = useState('')

  const label = entityName.charAt(0).toUpperCase() + entityName.slice(1)

  async function handleCreate() {
    await ctx.create()
  }

  async function handleDuplicate() {
    if (!ctx.active) return
    const duplicated = await ctx.duplicate(ctx.active.id)
    ctx.select(duplicated.id)
  }

  async function handleExport() {
    if (!ctx.active) return
    await Result.from(ctx.export(ctx.active.id)).catch()
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await Result.from(ctx.import(file)).catch()
    e.target.value = ''
  }

  async function handleDeleteConfirm() {
    if (!ctx.active) return
    await Result.from(ctx.delete(ctx.active.id)).catch()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <RippleButton
              size="icon"
              variant="stealth"
              aria-label={`${label} actions`}
              className={className}
            >
              <EllipsisIcon />
            </RippleButton>
          }
        />
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={handleCreate}>
            <PlusIcon className="size-4" />
            New
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={handleDuplicate} disabled={!ctx.active}>
            <CopyIcon className="size-4" />
            Duplicate
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onClick={handleImportClick}>
            <UploadIcon className="size-4" />
            Import
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={handleExport} disabled={!ctx.active}>
            <DownloadIcon className="size-4" />
            Export
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            variant="destructive"
            disabled={!ctx.active}
            onClick={() => {
              setDeleteName(ctx.active?.name ?? '')
              setDeleteOpen(true)
            }}
          >
            <Trash2Icon className="size-4" />
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${entityName}?`}
        description={`This will permanently delete "${deleteName}" and cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </>
  )
}
