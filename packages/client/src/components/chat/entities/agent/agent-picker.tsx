import {
  AgentCombobox,
  type AgentItem,
  AgentItemLabel,
} from '@/components/chat/sessions/agent-combobox'
import { FileOperationStatus } from '@/components/chat/skills/operation-status'
import { LabeledCheckbox, Combobox } from '@/components/ui'
import { useStableValue } from '@/hooks'
import { useEditingAgentId } from '@/hooks/chat'
import { useNewAgent } from '@/hooks/chat/agent'
import { useAgentFileOperation, useHomeOperation } from '@/hooks/chat/skills'
import type { CreateAgentArgs } from '@/lib/chat'
import { setEditingAgentId, startNewAgent } from '@/lib/chat/agent-editor-store'
import { triggerAgentDownload, uploadAgentFile } from '@/lib/chat/io'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useMemo, useState } from 'react'

import {
  EntityActionsMenu,
  type EntityPickerContext,
} from '../entity-actions-menu'

export type AgentPickerProps = {
  className?: string
  /** Allows confirming before switching agent. */
  confirmSwitch?: (proceed: () => void) => void
}

export function AgentPicker({ className, confirmSwitch }: AgentPickerProps) {
  const editingAgentId = useEditingAgentId()
  const newAgent = useNewAgent()
  const { home } = useHomeOperation(editingAgentId as Id<'agents'> | undefined)
  const [removeFolder, setRemoveFolder] = useState(false)
  const [cleanupId, setCleanupId] = useState<Id<'agentFileOperations'>>()
  const cleanup = useAgentFileOperation('agent-cleanup', cleanupId)
  const docs = useQuery(api.agents.list)
  const createAgent = useMutation(api.agents.create)
  const removeAgent = useMutation(api.agents.remove)
  const duplicateAgent = useMutation(api.agents.duplicate)
  const exportAsImage = useAction(api.actions.agents.exportAsImage)
  const importFromImage = useAction(api.actions.agents.importFromImage)
  const generateUploadUrl = useMutation(api.agents.generateAvatarUploadUrl)

  const records: AgentItem[] = useMemo(
    () =>
      (docs ?? []).map((d) => ({
        id: d._id,
        name: d.name,
        avatarId: d.avatarId,
      })),
    [docs],
  )

  const select = (id: string | null) =>
    confirmSwitch
      ? confirmSwitch(() => setEditingAgentId(id))
      : setEditingAgentId(id)

  const create = async () => {
    if (confirmSwitch) confirmSwitch(startNewAgent)
    else startNewAgent()
  }

  const del = async (id: string) => {
    const result = await removeAgent({ agentId: id as Id<'agents'>, removeFolder }) // prettier-ignore
    if (result.cleanupOperationId) setCleanupId(result.cleanupOperationId)
    if (id === editingAgentId) {
      // Point to a different agent after delete
      setEditingAgentId(records.find((r) => r.id !== id)?.id ?? null)
    }
  }

  const duplicate = async (id: string) => {
    const newId = await duplicateAgent({ agentId: id as Id<'agents'> })
    return {
      id: newId,
      name: `${records.find((r) => r.id === id)?.name ?? ''} (copy)`,
    }
  }

  const exportAgent = async (id: string) => {
    const result = await exportAsImage({ agentId: id as Id<'agents'> })
    triggerAgentDownload(result)
  }

  const importAgent = async (file: File) => {
    const parsed = await uploadAgentFile(file, generateUploadUrl)

    if (parsed.type === 'png') {
      const agentId = await importFromImage({ storageId: parsed.storageId })
      select(agentId)
      return { id: agentId, name: file.name.replace(/\.png$/, '') }
    }

    const { data } = parsed
    const name = (data.name as string | undefined) ?? 'Imported agent'

    const args = { ...data, name } as CreateAgentArgs

    const id = await createAgent(args)
    select(id)

    return { id, name }
  }

  const match = records.find((r) => r.id === editingAgentId)
  const stableSelected = useStableValue(match, Boolean(editingAgentId && !match)) // prettier-ignore
  const selected = newAgent ? undefined : stableSelected

  const ctx: EntityPickerContext<AgentItem> = {
    records,
    active: selected ?? null,
    select,
    create,
    delete: del,
    duplicate,
    export: exportAgent,
    import: importAgent,
  }

  return (
    <>
      <div className={cn('flex items-center gap-1.5', className)}>
        <AgentCombobox
          agents={records}
          value={ctx.active?.id}
          onValueChange={(v) => select(v || null)}
          emptyLabel="No agents found."
          trigger={
            <Combobox.Trigger
              className={cn('h-12 flex-1', ctx.active && 'pl-2!')}
            >
              <Combobox.DisplayValue placeholder="Select agent…">
                {newAgent ? (
                  'New agent (unsaved)'
                ) : (
                  <AgentItemLabel agent={selected} />
                )}
              </Combobox.DisplayValue>
            </Combobox.Trigger>
          }
        />
        <EntityActionsMenu
          context={ctx}
          onDeleteOpen={() => setRemoveFolder(false)}
          deleteDetails={
            home?.path && home.managed && home.members.length === 1 ? (
              <div className="mt-2 flex justify-center">
                <LabeledCheckbox
                  checked={removeFolder}
                  onCheckedChange={(checked) => setRemoveFolder(checked)}
                  labelClassName="text-center text-balance"
                >
                  Also delete the managed folder and its contents
                </LabeledCheckbox>
              </div>
            ) : (
              <span className="mt-2 block">
                {home && home.members.length > 1
                  ? 'The shared folder will be preserved for its other agents.'
                  : home?.path
                    ? 'The personal folder will be preserved.'
                    : 'No personal folder is assigned.'}
              </span>
            )
          }
          entityName="agent"
          accept=".json,.png"
          className="size-11"
        />
      </div>
      <FileOperationStatus operation={cleanup} />
    </>
  )
}
