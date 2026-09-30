import { type IconName, IconPicker } from '@/components/icon-picker/icon-picker'
import { Dialog, Input, RippleButton } from '@/components/ui'
import { useIsAdmin, useRecentWorkspaces } from '@/hooks/chat'
import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Doc } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation } from 'convex/react'
import { ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

import { WorkspacePickerDialog } from './workspace-picker-dialog'

type Source = Doc<'sessionFolders'>['sources'][number]

export function FolderDialog({
  folder,
  onClose,
}: {
  folder?: Doc<'sessionFolders'>
  onClose: () => void
}) {
  const [name, setName] = useState(folder?.name ?? '')
  const [icon, setIcon] = useState<IconName | undefined>(folder?.icon as IconName | undefined) // prettier-ignore
  const [sources, setSources] = useState<Source[]>(folder?.sources ?? [])
  const [busy, setBusy] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const isAdmin = useIsAdmin()
  const { recent, remember } = useRecentWorkspaces()
  const create = useAction(api.actions.folders.create)
  const rename = useMutation(api.sessionFolders.rename)
  const change = useAction(api.actions.folders.change)

  async function save() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      if (!folder) await create({ name, icon, sources })
      else {
        if (JSON.stringify(sources) !== JSON.stringify(folder.sources))
          await change({ folderId: folder._id, sources })
        await rename({ folderId: folder._id, name, icon })
      }
      onClose()
    } catch (err) {
      toastError(err, 'Could not save folder')
    } finally {
      setBusy(false)
    }
  }

  function addSource(path: string) {
    if (!sources.some((source) => source.path === path))
      setSources((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          path,
          label: path.split('/').filter(Boolean).at(-1) ?? path,
        },
      ])
    remember(path)
    setBrowsing(false)
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              {folder ? 'Edit folder' : 'Create folder'}
            </Dialog.Title>
          </Dialog.Header>
          <div className="flex flex-col gap-5 py-4">
            <div className="flex items-center gap-2">
              <IconPicker value={icon ?? 'folder'} onValueChange={setIcon} />
              <Input
                disabled={busy}
                autoFocus
                aria-label="Folder name"
                placeholder="Folder name"
                value={name}
                maxLength={80}
                onValueChange={setName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Filesystem access{' '}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </span>
              <div className="flex flex-col gap-2 rounded-xl border p-3">
                {sources.map((source, index) => (
                  <div
                    key={source.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{source.label}</span>
                        {index === 0 && (
                          <span className="bg-muted rounded px-1.5 text-xs">
                            Primary
                          </span>
                        )}
                      </div>
                      <div
                        className="text-muted-foreground truncate text-xs"
                        title={source.path}
                      >
                        {source.path}
                      </div>
                    </div>
                    {isAdmin && index > 0 && (
                      <RippleButton
                        size="icon"
                        variant="stealth"
                        aria-label={`Make ${source.label} primary`}
                        disabled={busy}
                        onClick={() =>
                          setSources([
                            source,
                            ...sources.filter((s) => s.id !== source.id),
                          ])
                        }
                      >
                        <ArrowUpIcon />
                      </RippleButton>
                    )}
                    {isAdmin && (
                      <RippleButton
                        size="icon"
                        variant="stealth"
                        aria-label={`Remove ${source.label}`}
                        disabled={busy}
                        onClick={() =>
                          setSources(sources.filter((s) => s.id !== source.id))
                        }
                      >
                        <XIcon />
                      </RippleButton>
                    )}
                  </div>
                ))}
                {isAdmin && (
                  <RippleButton
                    variant="surface"
                    disabled={busy || sources.length >= 20}
                    onClick={() => setBrowsing(true)}
                  >
                    <PlusIcon />
                    Add a directory
                  </RippleButton>
                )}
                {!sources.length && (
                  <p className="text-muted-foreground py-2 text-center text-xs">
                    Allow access to directories listed here
                  </p>
                )}
              </div>
            </div>
          </div>
          <Dialog.Footer>
            <RippleButton variant="surface" disabled={busy} onClick={onClose}>
              Cancel
            </RippleButton>
            <RippleButton
              variant="primary"
              disabled={busy || !name.trim()}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : folder ? 'Save' : 'Create folder'}
            </RippleButton>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
      <WorkspacePickerDialog
        open={browsing}
        onOpenChange={setBrowsing}
        initialPath={recent[0]}
        onSelect={addSource}
      />
    </>
  )
}
