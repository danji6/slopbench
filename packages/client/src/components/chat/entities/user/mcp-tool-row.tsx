import {
  Accordion,
  Input,
  RippleButton,
  Switch,
  Textarea,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { mcpToolAlias } from '@sb/core/types'
import { RotateCcwIcon } from 'lucide-react'

import type { McpToolMetaFormValues } from './settings-schema'

type McpToolRowProps = {
  value: string
  tool: McpToolMetaFormValues
  clashing: boolean
  onChange: (patch: Partial<McpToolMetaFormValues>) => void
}

export function McpToolRow({
  value,
  tool,
  clashing,
  onChange,
}: McpToolRowProps) {
  const nameOverridden = tool.nameOverride !== undefined
  const overridden = tool.descriptionOverride !== undefined
  const description = tool.descriptionOverride ?? tool.description ?? ''

  return (
    <Accordion.Item value={value}>
      <Accordion.Trigger className="h-9 px-3 text-sm font-normal">
        <span
          className={cn('flex-1 text-left', clashing && 'text-destructive')}
        >
          {mcpToolAlias(tool)}
        </span>
      </Accordion.Trigger>
      <Accordion.Content className="flex flex-col gap-1.5 px-3">
        <label className="flex items-center justify-between gap-2 text-sm">
          Allow in plan/read-only mode
          <Switch
            checked={tool.allowInReadOnly ?? true}
            onCheckedChange={(allowInReadOnly) => onChange({ allowInReadOnly })}
          />
        </label>
        <p className="text-muted-foreground text-xs">
          For security reasons, disable when the tool can make changes to the
          system.
        </p>
        {clashing && (
          <span className="text-destructive text-sm">
            Conflict: another enabled tool resolves to the same name. Only one
            will be used.
          </span>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Tool name:</span>
          <RippleButton
            type="button"
            size="sm"
            variant="stealth"
            disabled={!nameOverridden}
            className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
            onClick={() => onChange({ nameOverride: undefined })}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset
          </RippleButton>
        </div>
        <Input
          value={tool.nameOverride ?? tool.name}
          placeholder={tool.name}
          onValueChange={(nameOverride) => onChange({ nameOverride })}
          className="h-9 text-sm"
        />
        {nameOverridden && (
          <span className="text-muted-foreground text-xs">
            Original name: {tool.name}
          </span>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            Tool description:
          </span>
          <RippleButton
            type="button"
            size="sm"
            variant="stealth"
            disabled={!overridden}
            className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
            onClick={() => onChange({ descriptionOverride: undefined })}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset
          </RippleButton>
        </div>
        <Textarea
          value={description}
          placeholder="No description provided"
          onChange={(e) => onChange({ descriptionOverride: e.target.value })}
          className="max-h-48 min-h-20 text-sm"
        />
      </Accordion.Content>
    </Accordion.Item>
  )
}
