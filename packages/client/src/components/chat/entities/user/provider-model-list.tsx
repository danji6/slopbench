import { Label, RippleButton } from '@/components/ui'
import { PlusIcon } from 'lucide-react'

import { ModelRow } from './model-entry'
import type { ProviderOption } from './provider-types'
import type { ModelEntryFormValues } from './settings-schema'

type ProviderModelListProps = {
  catalogOnly?: boolean
  models: ModelEntryFormValues[]
  editorId: string
  defaultReasoning?: ProviderOption['defaultReasoning']
  binaryReasoningParameter?: string
  expandedModelIds: Set<string>
  onAdd: () => void
  onUpdate: (index: number, patch: Partial<ModelEntryFormValues>) => void
  onRemove: (index: number) => void
  onExpandedChange: (modelId: string, expanded: boolean) => void
}

export function ProviderModelList({
  catalogOnly,
  models,
  editorId,
  defaultReasoning,
  binaryReasoningParameter,
  expandedModelIds,
  onAdd,
  onUpdate,
  onRemove,
  onExpandedChange,
}: ProviderModelListProps) {
  return (
    <div className="flex flex-col gap-3">
      <Label className="text-muted-foreground text-sm">Models</Label>
      {!catalogOnly && (
        <RippleButton
          variant="input"
          size="sm"
          className="self-start text-sm"
          onClick={onAdd}
        >
          <PlusIcon />
          Add model
        </RippleButton>
      )}
      {models.length > 0 && (
        <div className="flex flex-col gap-1">
          {models.map((model, idx) => (
            <div key={model._clientId ?? `${model.id}:${idx}`}>
              {model.available === false && (
                <div className="flex items-center gap-2 text-sm">
                  <span>Not listed by provider</span>
                  {!catalogOnly && (
                    <RippleButton
                      size="sm"
                      onClick={() =>
                        onUpdate(idx, {
                          source: 'manual',
                          available: undefined,
                        })
                      }
                    >
                      Keep as manual
                    </RippleButton>
                  )}
                </div>
              )}
              <ModelRow
                catalogOnly={catalogOnly}
                key={model._clientId ?? `${model.id}:${idx}`}
                model={model}
                editorId={`${editorId}-${idx}`}
                defaultReasoning={defaultReasoning}
                binaryReasoningParameter={binaryReasoningParameter}
                open={expandedModelIds.has(
                  model._clientId ?? `${model.id}:${idx}`,
                )}
                onOpenChange={(expanded) =>
                  onExpandedChange(
                    model._clientId ?? `${model.id}:${idx}`,
                    expanded,
                  )
                }
                onChange={(patch) => onUpdate(idx, patch)}
                onRemove={() => onRemove(idx)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
