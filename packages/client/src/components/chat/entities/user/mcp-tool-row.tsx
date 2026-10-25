import { Accordion, Input, RippleButton, Switch } from '@/components/ui'
import { cn } from '@/lib/utils'
import { mcpToolAlias } from '@sb/core/types'
import { RotateCcwIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { McpToolDescription } from './mcp-tool-description'
import type { McpToolMetaFormValues } from './settings-schema'

type McpToolRowProps = {
  value: string
  tool: McpToolMetaFormValues
  clashing: boolean
  onChange: (patch: Partial<McpToolMetaFormValues>) => void
  descriptionEditor?: ReactNode
}

export function McpToolRow({
  value,
  tool,
  clashing,
  onChange,
  descriptionEditor,
}: McpToolRowProps) {
  const nameOverridden = tool.nameOverride !== undefined

  return (
    <Accordion.Item value={value}>
      <Accordion.Trigger className="h-9 px-3 text-sm font-normal">
        <span
          className={cn('flex-1 text-left', clashing && 'text-destructive')}
        >
          {mcpToolAlias(tool)}
        </span>
      </Accordion.Trigger>
      <Accordion.Content className="p-3">
        <div className="flex flex-col gap-1.5">
          <label className="mb-2 flex items-center justify-between gap-2 text-sm">
            Enabled
            <Switch
              checked={tool.enabled ?? true}
              onCheckedChange={(enabled) => onChange({ enabled })}
            />
          </label>
          {tool.diagnostic && (
            <p className="text-destructive text-xs">{tool.diagnostic}</p>
          )}
          <label className="flex items-center justify-between gap-2 text-sm">
            Allow in plan/read-only mode
            <Switch
              size="sm"
              checked={tool.allowInReadOnly ?? true}
              onCheckedChange={(allowInReadOnly) =>
                onChange({ allowInReadOnly })
              }
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
            size="sm"
          />
          {nameOverridden && (
            <span className="text-muted-foreground text-xs">
              Original name: {tool.name}
            </span>
          )}
          {descriptionEditor ?? (
            <McpToolDescription
              description={tool.description ?? ''}
              override={tool.descriptionOverride}
              onChange={(descriptionOverride) =>
                onChange({ descriptionOverride })
              }
            />
          )}
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}
