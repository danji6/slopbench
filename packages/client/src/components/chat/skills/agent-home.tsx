import { WorkspacePickerDialog } from '@/components/chat/sessions/workspace-picker-dialog'
import { ConfirmDialog, RippleButton } from '@/components/ui'
import { useAgentFileOperation } from '@/hooks/chat/skills'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { useState } from 'react'

import { FileOperationStatus } from './operation-status'

export function AgentHomeSettings({ agentId }: { agentId: Id<'agents'> }) {
  const home = useQuery(api.skills.getHome, { agentId })
  const operation = useAgentFileOperation(`home:${agentId}`, home?.operationId)
  const [browsing, setBrowsing] = useState(false)
  const [destination, setDestination] = useState<{ path?: string }>()

  function change(copyFiles: boolean) {
    if (!destination) {
      return
    }
    void operation.run({
      kind: 'home',
      agentId,
      destination: destination.path,
      copyFiles,
    })
  }

  return (
    <div className="space-y-3 p-4">
      <h3 className="font-medium">Personal folder</h3>
      <p className="text-muted-foreground text-sm">
        A persistent writable space shared by this agent’s sessions. Folder
        changes apply immediately.
      </p>
      <p className="text-sm break-all">
        {home?.path ?? 'Created when initialized or first used by the agent.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {home?.path ? (
          <RippleButton
            variant="input"
            onClick={() => void navigator.clipboard.writeText(home.path!)}
          >
            Copy path
          </RippleButton>
        ) : (
          <RippleButton
            disabled={operation.busy}
            onClick={() => void operation.run({ kind: 'ensure', agentId })}
          >
            Initialize folder
          </RippleButton>
        )}
        <RippleButton
          disabled={operation.busy}
          onClick={() => setBrowsing(true)}
        >
          Choose directory
        </RippleButton>
        {home?.customPath && (
          <RippleButton
            size="sm"
            variant="secondary"
            disabled={operation.busy}
            onClick={() => setDestination({})}
          >
            Use managed folder
          </RippleButton>
        )}
      </div>
      <FileOperationStatus operation={operation} />
      <WorkspacePickerDialog
        open={browsing}
        onOpenChange={setBrowsing}
        initialPath={home?.path}
        title="Select this agent’s personal folder"
        onSelect={(path) => setDestination({ path })}
      />
      <ConfirmDialog
        open={!!destination}
        onOpenChange={(open) => !open && setDestination(undefined)}
        title="Change personal folder?"
        description="Carry over files preserves your notes and customized skills. Start fresh keeps the old files where they are and installs pristine copies of assigned skills. Existing destination files will never be overwritten."
        confirmText="Carry over files"
        onConfirm={() => change(true)}
        extraAction={{
          text: 'Start fresh',
          variant: 'secondary',
          onConfirm: () => change(false),
        }}
      />
    </div>
  )
}
