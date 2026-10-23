import { md } from '@/components/markdown'
import {
  Checkbox,
  CodeEditor,
  HelpPopoverLabel,
  Input,
  Label,
  RippleButton,
  SettingsCollapsible,
  Switch,
  Tabs,
  TrashButton,
} from '@/components/ui'
import { expandNumber } from '@/lib/utils'
import { effectiveModel } from '@sb/core/discovered-model'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import {
  DEFAULT_BINARY_REASONING_PARAMETER,
  defaultModelReasoning,
  normalizeBinaryReasoningParameter,
} from '@sb/core/model-reasoning'
import {
  type ModelReasoning,
  REASONING_TIERS,
  type ReasoningTier,
} from '@sb/core/types'
import { useState } from 'react'

import { InferenceSettings } from '../../models'
import type { ModelEntryFormValues } from './settings-schema'

type ModelRowProps = {
  model: ModelEntryFormValues
  catalogOnly?: boolean
  editorId: string
  defaultReasoning?: ModelReasoning
  binaryReasoningParameter?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onChange: (patch: Partial<ModelEntryFormValues>) => void
  onRemove: () => void
}

export function ModelRow({
  model,
  catalogOnly,
  editorId,
  defaultReasoning,
  binaryReasoningParameter,
  open,
  onOpenChange,
  onChange,
  onRemove,
}: ModelRowProps) {
  const [tab, setTab] = useState('configuration')
  const resolved = effectiveModel(model)

  const configuredReasoning =
    resolved.reasoning ?? defaultReasoning ?? defaultModelReasoning()

  const reasoning =
    normalizeBinaryReasoningParameter(
      configuredReasoning,
      binaryReasoningParameter,
    ) ?? configuredReasoning

  return (
    <SettingsCollapsible
      open={open}
      onOpenChange={onOpenChange}
      variant="compact"
      label={
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">
            {resolved.label || model.id || 'New model'}
          </span>
          {model.label && model.id && (
            <span className="text-muted-foreground truncate font-mono text-xs font-normal">
              {model.id}
            </span>
          )}
        </span>
      }
      actions={
        <TrashButton
          variant="surface"
          onClick={onRemove}
          aria-label="Remove model"
        />
      }
      contentClassName="gap-4 pb-4"
      unmountOnClose
    >
      <div className="flex min-w-0 flex-col gap-2">
        <ModelIdentity
          model={model}
          catalogOnly={catalogOnly}
          onChange={onChange}
        />
        <ContextWindowField
          value={resolved.contextWindow}
          onChange={(contextWindow) => onChange({ contextWindow })}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.List>
          <Tabs.Trigger value="configuration">Configuration</Tabs.Trigger>
          <Tabs.Trigger value="inference">Inference</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Panels>
          <Tabs.Content value="configuration">
            <div className="flex flex-col gap-4">
              <ReasoningConfiguration
                value={reasoning}
                binaryParameter={
                  binaryReasoningParameter ?? DEFAULT_BINARY_REASONING_PARAMETER
                }
                onChange={(value) => onChange({ reasoning: value })}
              />
              {model.discovered?.reasoning && model.reasoning !== undefined && (
                <RippleButton
                  size="sm"
                  variant="stealth"
                  className="self-start"
                  onClick={() => onChange({ reasoning: undefined })}
                >
                  Use discovered reasoning
                </RippleButton>
              )}
              <ExtraParametersField
                editorId={editorId}
                value={model.extraParameters ?? ''}
                onChange={(value) =>
                  onChange({ extraParameters: value || undefined })
                }
              />
            </div>
          </Tabs.Content>
          <Tabs.Content value="inference">
            <InferenceSettings
              density="compact"
              value={model.inference ?? {}}
              onChange={(inference) => onChange({ inference })}
            />
          </Tabs.Content>
        </Tabs.Panels>
      </Tabs>
    </SettingsCollapsible>
  )
}

function ModelIdentity({
  model,
  catalogOnly,
  onChange,
}: Pick<ModelRowProps, 'model' | 'onChange' | 'catalogOnly'>) {
  const resolved = effectiveModel(model)

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label className="text-muted-foreground text-sm">Model ID</Label>
        <Input
          className="h-9 font-mono text-sm"
          placeholder="e.g. model-id"
          disabled={catalogOnly}
          value={model.id}
          onChange={(event) => onChange({ id: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-muted-foreground text-sm">
          Display name <span className="opacity-60">(optional)</span>
        </Label>
        <Input
          className="h-9 w-full text-sm"
          placeholder={model.discovered?.label ?? 'e.g. Model Name'}
          value={resolved.label ?? ''}
          onChange={(event) => onChange({ label: event.target.value })}
        />
        {model.discovered?.label && model.label !== undefined && (
          <RippleButton
            size="sm"
            variant="stealth"
            className="self-start"
            onClick={() => onChange({ label: undefined })}
          >
            Use discovered value
          </RippleButton>
        )}
      </div>
    </>
  )
}

function ContextWindowField({
  value,
  onChange,
}: {
  value?: number
  onChange: (value: number | undefined) => void
}) {
  const [text, setText] = useState(value?.toString() ?? '')
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setText(value?.toString() ?? '')
  }

  function commit(raw: string) {
    setText(raw)
    const trimmed = raw.trim()
    if (!trimmed) return onChange(undefined)
    try {
      onChange(Math.round(expandNumber(trimmed)))
    } catch {
      // Keep typing
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <HelpPopoverLabel
        className="text-muted-foreground text-sm"
        help={md`
          Maximum context tokens for this model. Only used for
          visual feedback. Accepts shorthand like \`128k\` or \`1m\`.
        `}
      >
        Context window <span className="opacity-60">(optional)</span>
      </HelpPopoverLabel>
      <Input
        className="h-9 max-w-32 font-mono text-sm"
        placeholder="e.g. 128k"
        value={text}
        onChange={(event) => commit(event.target.value)}
      />
    </div>
  )
}

function ReasoningConfiguration({
  value,
  binaryParameter,
  onChange,
}: {
  value: ModelReasoning
  binaryParameter: string
  onChange: (value: ModelReasoning) => void
}) {
  const isBinary = value.type === 'binary'
  const efforts = value.type === 'effort' ? value.efforts : []

  function setEffort(tier: ReasoningTier, checked: boolean) {
    const selected = new Set([...efforts, ...(checked ? [tier] : [])])
    if (!checked) selected.delete(tier)
    const next = REASONING_TIERS.filter((candidate) => selected.has(candidate))
    onChange(next.length ? { type: 'effort', efforts: next } : { type: 'none' })
  }

  return (
    <div className="flex flex-col gap-3 pt-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-sm">Reasoning</Label>
          <p className="text-muted-foreground text-xs">
            Choose the effort levels this model supports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground text-xs">
            Binary thinking
          </Label>
          <Switch
            size="sm"
            checked={isBinary}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? { type: 'binary', parameter: binaryParameter }
                  : defaultModelReasoning(),
              )
            }
          />
        </div>
      </div>

      {isBinary ? (
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-sm">
            Boolean request parameter
          </Label>
          <Input
            className="h-9 font-mono text-sm"
            value={value.parameter}
            placeholder={binaryParameter}
            onChange={(event) =>
              onChange({ type: 'binary', parameter: event.target.value })
            }
          />
          {!value.parameter.trim() && (
            <p className="text-destructive text-xs">
              Parameter name is required.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {REASONING_TIERS.map((tier) => (
            <Label key={tier} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={efforts.includes(tier)}
                onCheckedChange={(checked) => setEffort(tier, checked === true)}
              />
              {tier === 'xhigh' ? 'XHigh' : capitalize(tier)}
            </Label>
          ))}
        </div>
      )}
    </div>
  )
}

function ExtraParametersField({
  editorId,
  value,
  onChange,
}: {
  editorId: string
  value: string
  onChange: (value: string) => void
}) {
  let error: string | undefined
  try {
    parseModelExtraParameters(value)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Invalid JSON'
  }

  return (
    <div className="border-border flex flex-col gap-1.5 border-t pt-4">
      <HelpPopoverLabel
        className="text-muted-foreground text-sm"
        help="Extra JSON fields merged into the request body."
      >
        Extra parameters <span className="opacity-60">(optional)</span>
      </HelpPopoverLabel>
      <CodeEditor
        value={value}
        onChange={onChange}
        fullscreenId={`model-extra-parameters-${editorId}`}
        language="json"
        placeholder={'{\n  "thinking_budget": 4096\n}'}
        className="h-28 flex-none"
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
