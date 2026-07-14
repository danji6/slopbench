import {
  AgentCombobox,
  type AgentItem,
  AgentItemLabel,
} from '@/components/chat/sessions/agent-combobox'
import { Combobox } from '@/components/ui'
import { useEditingAgent, useSelectAgent } from '@/hooks/chat'
import type { CreateAgentArgs } from '@/lib/chat'
import { triggerAgentDownload, uploadAgentFile } from '@/lib/chat/io'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation, useQuery } from 'convex/react'

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
  const editingAgent = useEditingAgent()
  const selectAgent = useSelectAgent()
  const select = (id: string | null) =>
    confirmSwitch ? confirmSwitch(() => selectAgent(id)) : selectAgent(id)
  const docs = useQuery(api.agents.list) ?? []
  const createAgent = useMutation(api.agents.create)
  const removeAgent = useMutation(api.agents.remove)
  const duplicateAgent = useMutation(api.agents.duplicate)
  const exportAsImage = useAction(api.actions.agents.exportAsImage)
  const importFromImage = useAction(api.actions.agents.importFromImage)
  const generateUploadUrl = useMutation(api.agents.generateAvatarUploadUrl)

  const records: AgentItem[] = docs.map((d) => ({
    id: d._id,
    name: d.name,
    avatarId: d.avatarId,
  }))

  const create = async () => {
    const id = await createAgent({ name: 'New agent' })
    select(id)
    return { id, name: 'New agent' }
  }

  const del = async (id: string) => {
    await removeAgent({ agentId: id as Id<'agents'> })
  }

  const duplicate = async (id: string) => {
    const newId = await duplicateAgent({ agentId: id as Id<'agents'> })
    return {
      id: newId,
      name: `${docs.find((d) => d._id === id)?.name ?? ''} (copy)`,
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

  const ctx: EntityPickerContext<AgentItem> = {
    records,
    active: editingAgent
      ? {
          id: editingAgent._id,
          name: editingAgent.name,
          avatarId: editingAgent.avatarId,
        }
      : null,
    select,
    create,
    delete: del,
    duplicate,
    export: exportAgent,
    import: importAgent,
  }

  const selected = records.find((r) => r.id === ctx.active?.id)

  return (
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
            <Combobox.DisplayValue placeholder="Select agent...">
              <AgentItemLabel agent={selected} />
            </Combobox.DisplayValue>
          </Combobox.Trigger>
        }
      />
      <EntityActionsMenu
        context={ctx}
        entityName="agent"
        accept=".json,.png"
        className="size-11"
      />
    </div>
  )
}
