import { WorkspacePickerDialog } from '@/components/chat/sessions/workspace-picker-dialog'
import { AlertMessage, ConfirmDialog, RippleButton } from '@/components/ui'
import { useAgentHomeStatus } from '@/hooks/chat/agent-home-status'
import { useHomeOperation } from '@/hooks/chat/skills'
import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import {
  CopyIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  TrashIcon,
  UnlinkIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { FileOperationStatus } from './operation-status'

type Capability = { supported: boolean; machine: string }

export function AgentHomeSettings({ agentId }: { agentId: Id<'agents'> }) {
  const { home, operation } = useHomeOperation(agentId)
  const availability = useAgentHomeStatus(
    agentId,
    home?.path,
    home?.revision,
    operation.busy,
  )
  const desktop = useAction(api.actions.skills.desktop)
  const openFolder = useAction(api.actions.skills.openFolder)
  const [capability, setCapability] = useState<Capability>()
  const [browsing, setBrowsing] = useState(false)
  const [destination, setDestination] = useState<string>()
  const [removing, setRemoving] = useState<'detach' | 'delete'>()
  const exists = !!home?.path && availability?.exists === true
  const missing = !!home?.path && availability?.exists === false
  const loading = home === undefined || (!!home.path && !availability)
  const busy = operation.busy || loading
  const removable = !!home?.managed && home.members.length === 1

  useEffect(() => {
    let active = true
    void desktop({})
      .then((value) => {
        if (active) setCapability(value)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [desktop])

  function select(path: string) {
    if (exists) setDestination(path)
    else
      void operation.run({
        kind: 'home',
        agentId,
        destination: path,
        copyFiles: false,
      })
  }

  function change(copyFiles: boolean) {
    if (destination)
      void operation.run({
        kind: 'home',
        agentId,
        destination,
        copyFiles,
      })
  }

  function detach(removeFolder: boolean) {
    void operation.run({ kind: 'detach', agentId, removeFolder })
  }

  return (
    <div className="space-y-3 p-4">
      <h3 className="font-medium">Personal folder</h3>
      <p className="text-muted-foreground text-sm">
        Assign a home folder to this agent to persist data across sessions.
      </p>
      {loading ? (
        <p className="text-muted-foreground text-sm" role="status">
          Checking personal folder…
        </p>
      ) : missing ? (
        <p className="text-muted-foreground text-sm">
          The assigned folder is missing.
        </p>
      ) : exists ? (
        <p className="text-sm font-semibold break-all">
          {home?.managed
            ? "This agent's folder is being managed by the app."
            : home?.path}
        </p>
      ) : null}
      {availability?.error && <AlertMessage>{availability.error}</AlertMessage>}
      {home && home.members.length > 1 && (
        <p className="text-muted-foreground text-sm">
          Shared with{' '}
          {home.members
            .filter((member) => member.id !== agentId)
            .map((member) => member.name)
            .join(', ')}
          .
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {home?.path && (
          <RippleButton
            variant="input"
            onClick={() => void navigator.clipboard.writeText(home.path!)}
          >
            <CopyIcon /> Copy path
          </RippleButton>
        )}
        {(!home?.path || (missing && home.managed)) && (
          <RippleButton
            disabled={busy}
            onClick={() => void operation.run({ kind: 'ensure', agentId })}
          >
            {missing ? 'Recreate folder' : 'Initialize folder'}
          </RippleButton>
        )}
        {exists && capability?.supported && (
          <RippleButton
            variant="input"
            disabled={busy}
            title={`Open on ${capability.machine} (sidecar machine)`}
            onClick={() =>
              void openFolder({ agentId }).catch((error) =>
                toastError(error, 'Could not open folder'),
              )
            }
          >
            <ExternalLinkIcon /> Open externally
          </RippleButton>
        )}
        <RippleButton disabled={busy} onClick={() => setBrowsing(true)}>
          <FolderOpenIcon /> Choose directory
        </RippleButton>
        {home?.path && (
          <>
            <RippleButton
              variant="secondary"
              disabled={busy}
              onClick={() => setRemoving('detach')}
            >
              <UnlinkIcon /> Detach folder
            </RippleButton>
            {removable && (
              <RippleButton
                variant="destructive"
                disabled={busy}
                onClick={() => setRemoving('delete')}
              >
                <TrashIcon /> Delete folder
              </RippleButton>
            )}
          </>
        )}
      </div>
      <FileOperationStatus operation={operation} />
      <WorkspacePickerDialog
        open={browsing}
        onOpenChange={setBrowsing}
        initialPath={exists ? home?.path : undefined}
        title="Select this agent’s personal folder"
        onSelect={(path) => select(path)}
      />
      <ConfirmDialog
        open={!!destination}
        onOpenChange={(open) => !open && setDestination(undefined)}
        title="Change personal folder?"
        description="Carry over copies files and preserves the original folder. Change only keeps existing destination files and adds clean copies of assigned skills. Selecting a registered home adopts its files and skills without copying."
        confirmText="Carry over"
        onConfirm={() => change(true)}
        extraAction={{
          text: 'Change only',
          variant: 'secondary',
          onConfirm: () => change(false),
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(undefined)}
        title={
          removing === 'delete'
            ? 'Delete personal folder?'
            : 'Detach personal folder?'
        }
        description={
          removing === 'delete'
            ? 'This will permanently delete the folder and all of its contents.'
            : removable
              ? 'Remove this agent’s access to the folder. Keep the files, or delete the folder and its contents.'
              : 'Remove this agent’s access to the folder. The files will be preserved.'
        }
        confirmText={removing === 'delete' ? 'Delete folder' : 'Keep files'}
        variant={removing === 'delete' ? 'destructive' : 'primary'}
        onConfirm={() => detach(removing === 'delete')}
        extraAction={
          removing === 'detach' && removable
            ? {
                text: 'Delete files',
                variant: 'destructive',
                onConfirm: () => detach(true),
              }
            : undefined
        }
      />
    </div>
  )
}
