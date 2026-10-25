import {
  Accordion,
  Combobox,
  Input,
  RippleButton,
  SettingsCollapsible,
  Switch,
  TooltipButton,
} from '@/components/ui'
import { useMcpToolDiscovery } from '@/hooks/chat'
import { extractErrorMessage } from '@/lib/errors'
import type { Id } from '@sb/convex/_generated/dataModel'
import {
  type McpDialedTransport,
  type McpToolMeta,
  type McpTransport,
  SUPPORTED_MCP_TRANSPORTS,
  mcpToolName,
} from '@sb/core/types'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'

import { McpBrokerSettings } from './mcp-broker-settings'
import { McpCatalog } from './mcp-catalog'
import { parseMcpLaunch } from './mcp-launch'
import { McpLocalSettings } from './mcp-local-settings'
import { McpProtocol } from './mcp-protocol'
import { McpRuntimes } from './mcp-runtimes'
import { McpTimeouts } from './mcp-timeouts'
import { McpToolRow } from './mcp-tool-row'
import type {
  McpServerFormValues,
  McpToolMetaFormValues,
} from './settings-schema'

export type McpServerItem = McpServerFormValues & {
  rhfKey: string
  index: number
}

/** Names the picked transport, revealing what `auto` negotiated once known. */
function transportLabel(
  transport: string | undefined,
  dialed: McpDialedTransport | null,
): string {
  const label =
    SUPPORTED_MCP_TRANSPORTS.find((t) => t.id === transport)?.label ??
    transport ??
    ''
  if (transport !== 'auto' || !dialed) return label
  const dialedLabel =
    SUPPORTED_MCP_TRANSPORTS.find((t) => t.id === dialed)?.label ?? dialed
  return `${label} (${dialedLabel})`
}

type McpServerCardProps = {
  item: McpServerItem
  count: number
  conflicts: Set<string>
  onChange: (patch: Partial<McpServerFormValues>) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

export function McpServerCard({
  item,
  count,
  conflicts,
  onChange,
  onMove,
  onRemove,
}: McpServerCardProps) {
  const discover = useMcpToolDiscovery()

  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [dialed, setDialed] = useState<McpDialedTransport | null>(null)

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      const { tools, transport, catalogId } = await discover({
        url: item.url,
        command: item.command,
        cwd: item.cwd,
        env: item.transport === 'stdio' ? parseMcpLaunch(item).env : undefined,
        args:
          item.transport === 'stdio' ? parseMcpLaunch(item).args : undefined,
        startupTimeoutMs: item.startupTimeoutMs,
        transport: item.transport,
        apiKey: item.apiKey,
        serverId: item.serverId as Id<'mcpServers'> | undefined,
      })
      setDialed(transport ?? null)
      if (!catalogId) onChange({ tools: mergeOverrides(item.tools, tools) })
      else onChange({ catalogId })
    } catch (err) {
      setDialed(null)
      setError(extractErrorMessage(err, 'Failed to discover tools'))
    } finally {
      setRefreshing(false)
    }
  }

  const isClashing = (tool: McpToolMetaFormValues) =>
    item.enabled && conflicts.has(mcpToolName(item, tool))

  return (
    <SettingsCollapsible
      open={expanded}
      onOpenChange={setExpanded}
      variant="editable"
      className="p-1.5"
      contentClassName="p-2"
      label={
        <>
          <Switch
            size="sm"
            checked={item.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
          <Input
            value={item.label}
            placeholder="Label"
            onValueChange={(label) => onChange({ label })}
            className="h-8 flex-1"
          />
          {expanded && (
            <Combobox
              value={item.transport}
              onValueChange={(transport) => {
                setDialed(null)
                onChange({ transport: transport as McpTransport })
              }}
              noDeselect
            >
              <Combobox.Trigger
                variant="input"
                size="sm"
                className="h-8 w-32 shrink-0"
              >
                <Combobox.DisplayValue>
                  {(transport) => transportLabel(transport, dialed)}
                </Combobox.DisplayValue>
              </Combobox.Trigger>
              <Combobox.Content align="start" className="w-36">
                <Combobox.List>
                  {SUPPORTED_MCP_TRANSPORTS.map((transport) => (
                    <Combobox.Item key={transport.id} value={transport.id}>
                      {transport.label}
                    </Combobox.Item>
                  ))}
                </Combobox.List>
              </Combobox.Content>
            </Combobox>
          )}
        </>
      }
      actions={
        <>
          <TooltipButton
            type="button"
            tooltip="Move up"
            size="icon"
            variant="stealth"
            disabled={item.index === 0}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon />
          </TooltipButton>
          <TooltipButton
            type="button"
            tooltip="Move down"
            size="icon"
            variant="stealth"
            disabled={item.index === count - 1}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon />
          </TooltipButton>
          <TooltipButton
            type="button"
            tooltip="Remove"
            size="icon"
            variant="stealth"
            className="text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2Icon />
          </TooltipButton>
        </>
      }
    >
      {item.transport === 'stdio' ? (
        <McpLocalSettings item={item} onChange={onChange} />
      ) : (
        <div className="flex w-full items-center gap-2 px-1">
          <Input
            value={item.url}
            placeholder="http://localhost:11235/mcp"
            onValueChange={(url) => {
              setDialed(null)
              onChange({ url })
            }}
            size="sm"
            className="flex-1"
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5 pl-4">
        <McpTimeouts item={item} onChange={onChange} />
        <McpBrokerSettings
          enabled={item.brokerEnabled ?? false}
          onChange={(brokerEnabled) => onChange({ brokerEnabled })}
        />
      </div>
      <div className="flex w-full items-center gap-2 px-1">
        <Input
          type="password"
          // Undefined keeps the stored key, while an empty string clears it
          value={item.apiKey ?? ''}
          placeholder={`API key (${item.hasKey ? 'already set' : 'optional'})`}
          onValueChange={(apiKey) => onChange({ apiKey })}
          size="sm"
          className="flex-1"
        />
      </div>
      <RippleButton
        type="button"
        size="sm"
        variant="input"
        disabled={
          refreshing || (item.transport === 'stdio' ? !item.command : !item.url)
        }
        className="mx-auto mt-1 w-64 max-w-full shrink-0"
        onClick={handleRefresh}
      >
        <RefreshCwIcon className={refreshing ? 'animate-spin' : undefined} />
        {item.serverId ? 'Refresh catalog' : 'Probe'}
      </RippleButton>
      {item.serverId && (
        <McpProtocol
          key={item.serverId}
          serverId={item.serverId as Id<'mcpServers'>}
        />
      )}
      {item.serverId && <McpRuntimes serverKey={item.id} />}
      {item.serverId && (
        <McpCatalog
          serverId={item.serverId as Id<'mcpServers'>}
          overrides={item.tools}
          onChange={(tools) => onChange({ tools })}
        />
      )}
      {error ? (
        <div className="text-destructive px-3 text-xs">{error}</div>
      ) : !item.catalogId && item.tools && item.tools.length > 0 ? (
        <Accordion>
          {item.tools.map((tool, index) => (
            <McpToolRow
              key={tool.name}
              value={tool.name}
              tool={tool}
              clashing={isClashing(tool)}
              onChange={(patch) =>
                onChange({
                  tools: item.tools?.map((row, i) =>
                    i === index ? { ...row, ...patch } : row,
                  ),
                })
              }
            />
          ))}
        </Accordion>
      ) : !item.catalogId ? (
        <div className="text-muted-foreground mx-auto px-3 py-2 text-xs">
          No tools discovered yet
        </div>
      ) : null}
    </SettingsCollapsible>
  )
}

/** Keeps the user's custom metadata across discovery, matched by tool name. */
function mergeOverrides(
  previous: McpToolMetaFormValues[] | undefined,
  discovered: McpToolMeta[],
): McpToolMetaFormValues[] {
  const overrides = new Map(
    (previous ?? []).map((tool) => [
      tool.name,
      {
        nameOverride: tool.nameOverride,
        allowInReadOnly: tool.allowInReadOnly,
        descriptionOverride: tool.descriptionOverride,
      },
    ]),
  )
  return discovered.map((tool) => ({
    ...tool,
    ...overrides.get(tool.name),
  }))
}
