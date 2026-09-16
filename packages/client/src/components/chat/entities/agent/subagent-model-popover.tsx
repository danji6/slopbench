import { Popover, RippleButton } from '@/components/ui'
import { useModels } from '@/hooks/chat'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import {
  defaultModelReasoning,
  normalizeReasoningEffort,
} from '@sb/core/model-reasoning'
import { normalizeSubagentOverrides } from '@sb/core/subagent-settings'
import type { AgentSubagentOverride } from '@sb/core/types'
import { Settings2Icon, XIcon } from 'lucide-react'
import { type Control, useController } from 'react-hook-form'

import { ModelPicker } from '../../models/model-picker'
import { ReasoningPicker } from '../../models/reasoning-picker'
import type { AgentFormValues } from './agent-form'

type SubagentModelPopoverProps = {
  control: Control<AgentFormValues>
  agent: Pick<Doc<'agents'>, '_id' | 'name'>
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Mounts model controls for the subagent being configured. */
export function SubagentModelPopover({
  control,
  agent,
  open,
  onOpenChange,
}: SubagentModelPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        render={<RippleButton type="button" variant="stealth" size="icon-sm" />}
        aria-label={`Configure ${agent.name} model and reasoning`}
      >
        <Settings2Icon className="size-4" />
      </Popover.Trigger>
      <Popover.Content align="end" className="w-60 p-4">
        {open && (
          <>
            <div className="flex items-center justify-between gap-2">
              <Popover.Title>{agent.name}</Popover.Title>
              <Popover.Close
                render={
                  <RippleButton
                    type="button"
                    variant="stealth"
                    size="icon-sm"
                  />
                }
                aria-label="Close model settings"
              >
                <XIcon className="size-4" />
              </Popover.Close>
            </div>
            <SubagentModelFields control={control} agentId={agent._id} />
          </>
        )}
      </Popover.Content>
    </Popover>
  )
}

function SubagentModelFields({
  control,
  agentId,
}: {
  control: Control<AgentFormValues>
  agentId: Id<'agents'>
}) {
  const { field } = useController({ control, name: 'subAgentOverrides' })
  const overrides = field.value ?? []
  const value = overrides.find((entry) => entry.agentId === agentId)
  const { models, isLoading } = useModels()
  const model = models.find((entry) => entry.id === value?.modelId) ?? null
  const unavailable = !isLoading && !!value?.modelId && !model

  function update(patch: Partial<AgentSubagentOverride>) {
    field.onChange(
      normalizeSubagentOverrides([
        ...overrides,
        { ...value, ...patch, agentId },
      ]),
    )
  }

  function setModel(modelId: string) {
    const selected = models.find((entry) => entry.id === modelId)
    update({
      modelId: modelId || undefined,
      reasoningEffort:
        value?.reasoningEffort === undefined || !selected
          ? value?.reasoningEffort
          : normalizeReasoningEffort(
              value.reasoningEffort,
              selected.reasoning ?? defaultModelReasoning(),
            ),
    })
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span>Model</span>
        <ModelPicker
          className="w-full"
          aria-label="Subagent model"
          inheritLabel="Inherit"
          value={value?.modelId ?? ''}
          selectedModel={
            model ?? (value?.modelId ? { id: value.modelId } : null)
          }
          onValueChange={setModel}
        />
        {unavailable && (
          <p className="text-destructive text-sm" role="status">
            This model is unavailable. Choose another model or inherit from the
            main session before spawning this agent.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span>Reasoning</span>
        <ReasoningPicker
          className="w-full"
          aria-label="Subagent reasoning"
          value={value?.reasoningEffort}
          model={model}
          onInherit={() => update({ reasoningEffort: undefined })}
          onValueChange={(reasoningEffort) => update({ reasoningEffort })}
        />
      </div>
      <Popover.Description className="text-xs">
        Used when this parent agent spawns this subagent. Changes apply to new
        tasks.
      </Popover.Description>
    </>
  )
}
