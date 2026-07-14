import { Button, SettingsList } from '@/components/ui'
import { useActiveSession, useRecentWorkspaces } from '@/hooks/chat'
import { toast } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import { useAction } from 'convex/react'
import { FolderIcon } from 'lucide-react'
import { useState } from 'react'

import { WorkspacePickerDialog } from './workspace-picker-dialog'

export function SessionWorkspaceSection() {
  const session = useActiveSession()
  const { recent, remember } = useRecentWorkspaces()
  const bindWorkspace = useAction(api.actions.workspaces.bind)
  const clearWorkspace = useAction(api.actions.workspaces.clear)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function selectWorkspace(root: string) {
    if (!session) return
    setBusy(true)
    try {
      await bindWorkspace({ sessionId: session._id, root })
      remember(root)
      toast('Workspace configured')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function clearCurrent() {
    if (!session) return
    setBusy(true)
    try {
      await clearWorkspace({ sessionId: session._id })
      toast('Workspace cleared')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsList>
      <SettingsList.Item
        orientation="vertical"
        unclickable
        label="Working directory"
        description={
          session?.workspace
            ? `Configured: ${session.workspace.label}`
            : 'Coding tools stay unavailable until a directory is configured.'
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="input"
            size="sm"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            <FolderIcon />
            {session?.workspace ? 'Change' : 'Configure'}
          </Button>
          <Button
            variant="input"
            size="sm"
            disabled={busy || !session?.workspace}
            onClick={() => void clearCurrent()}
          >
            Clear
          </Button>
        </div>
      </SettingsList.Item>
      <WorkspacePickerDialog
        open={open}
        onOpenChange={setOpen}
        initialPath={recent[0] ?? undefined}
        onSelect={(root) => void selectWorkspace(root)}
      />
    </SettingsList>
  )
}
