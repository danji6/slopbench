import {
  Accordion,
  Collapsible,
  Combobox,
  Input,
  RippleButton,
  SearchableList,
  SettingsList,
  Switch,
  Textarea,
  TooltipButton,
} from '@/components/ui'
import { useMcpToolDiscovery, useTools } from '@/hooks/chat'
import { cn, generateId } from '@/lib/utils'
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
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Control } from 'react-hook-form'
import { useFieldArray } from 'react-hook-form'

import type {
  McpServerFormValues,
  McpToolMetaFormValues,
  SettingsFormValues,
} from './settings-schema'

export function McpSettings({
  control,
}: {
  control: Control<SettingsFormValues>
}) {
  const { fields, append, update, remove, move } = useFieldArray<
    SettingsFormValues,
    'mcpServers',
    'rhfKey'
  >({ control, name: 'mcpServers', keyName: 'rhfKey' })

  const conflicts = useToolConflicts(fields)
  const items = fields.map((field, index) => ({ ...field, index }))

  function addServer() {
    append({
      id: generateId(),
      label: '',
      url: '',
      transport: 'auto',
      enabled: true,
      hasKey: false,
      _clientId: generateId(),
    })
  }

  return (
    <SettingsList className="pb-4">
      <SettingsList.Item
        label="MCP servers"
        description="Connect external Model Context Protocol servers."
        unclickable
        unhoverable
        orientation="vertical"
      >
        <SearchableList<McpServerItem>
          items={items}
          keys={(item) => item._clientId ?? item.id}
          fields={['label', 'url']}
          pageSize={10}
          searchThreshold={5}
          searchPlaceholder="Search servers..."
          actions={
            <RippleButton
              type="button"
              size="sm"
              variant="input"
              onClick={addServer}
            >
              <PlusIcon />
              Add
            </RippleButton>
          }
          empty={() => (
            <div className="text-muted-foreground p-2 text-center text-xs">
              No MCP servers configured
            </div>
          )}
          className="flex flex-col gap-2"
          itemProps={{ className: 'w-full' }}
          render={(item) => (
            <McpServerCard
              item={item}
              count={fields.length}
              conflicts={conflicts}
              onChange={(patch) => {
                const { rhfKey: _, index: __, ...data } = item
                update(item.index, { ...data, ...patch })
              }}
              onMove={(direction) => move(item.index, item.index + direction)}
              onRemove={() => remove(item.index)}
            />
          )}
        />
      </SettingsList.Item>
    </SettingsList>
  )
}

type McpServerItem = McpServerFormValues & { rhfKey: string; index: number }

/** Tool names that collide across enabled servers or with a built-in tool. */
function useToolConflicts(servers: McpServerFormValues[]): Set<string> {
  const { tools } = useTools()
  const reserved = useMemo(
    () =>
      new Set(
        tools
          .filter((tool) => tool.category !== 'mcp')
          .map((tool) => tool.name),
      ),
    [tools],
  )

  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const server of servers) {
      if (!server.enabled) continue
      for (const tool of server.tools ?? []) {
        const name = mcpToolName(server, tool.name)
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    const conflicts = new Set<string>()
    for (const [name, count] of counts) {
      if (count > 1 || reserved.has(name)) conflicts.add(name)
    }
    return conflicts
  }, [servers, reserved])
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

function McpServerCard({
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
      const { tools, transport } = await discover({
        url: item.url,
        transport: item.transport,
        apiKey: item.apiKey,
        serverId: item.serverId as Id<'mcpServers'> | undefined,
      })
      setDialed(transport ?? null)
      onChange({ tools: mergeOverrides(item.tools, tools) })
    } catch (err) {
      setDialed(null)
      setError(err instanceof Error ? err.message : 'Failed to discover tools')
    } finally {
      setRefreshing(false)
    }
  }

  const isClashing = (tool: McpToolMetaFormValues) =>
    item.enabled && conflicts.has(mcpToolName(item, tool.name))

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="bg-m3-surface-container-low border-input w-full rounded-2xl border p-1.5"
    >
      <div className="flex w-full items-center gap-2">
        <RippleButton
          type="button"
          variant="stealth"
          size="icon"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setExpanded((v) => !v)}
        >
          <Accordion.Icon isExpanded={expanded} className="size-4" />
        </RippleButton>
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
      </div>
      <Collapsible.Content className="p-0 pt-1.5">
        <div className="flex w-full items-center gap-2 px-1">
          <Input
            value={item.url}
            placeholder="http://localhost:11235/mcp"
            onValueChange={(url) => {
              setDialed(null)
              onChange({ url })
            }}
            className="h-9 flex-1"
          />
        </div>
        <div className="flex w-full items-center gap-2 px-1">
          <Input
            type="password"
            // Undefined keeps the stored key, while an empty string clears it
            value={item.apiKey ?? ''}
            placeholder={`API key (${item.hasKey ? 'already set' : 'optional'})`}
            onValueChange={(apiKey) => onChange({ apiKey })}
            className="h-9 flex-1"
          />
          <RippleButton
            type="button"
            size="sm"
            variant="input"
            disabled={refreshing || !item.url}
            className="shrink-0"
            onClick={handleRefresh}
          >
            <RefreshCwIcon
              className={refreshing ? 'animate-spin' : undefined}
            />
            Discover
          </RippleButton>
        </div>
        {error ? (
          <div className="text-destructive px-3 text-xs">{error}</div>
        ) : item.tools && item.tools.length > 0 ? (
          <Accordion>
            {item.tools.map((tool, index) => (
              <McpToolRow
                key={tool.name}
                value={tool.name}
                tool={tool}
                clashing={isClashing(tool)}
                onChange={(descriptionOverride) =>
                  onChange({
                    tools: item.tools?.map((row, i) =>
                      i === index ? { ...row, descriptionOverride } : row,
                    ),
                  })
                }
              />
            ))}
          </Accordion>
        ) : (
          <div className="text-muted-foreground px-3 text-xs">
            No tools discovered yet
          </div>
        )}
      </Collapsible.Content>
    </Collapsible>
  )
}

/** Keeps the user's descriptions across a re-discovery, matched by tool name. */
function mergeOverrides(
  previous: McpToolMetaFormValues[] | undefined,
  discovered: McpToolMeta[],
): McpToolMetaFormValues[] {
  const overrides = new Map(
    (previous ?? []).map((tool) => [tool.name, tool.descriptionOverride]),
  )
  return discovered.map((tool) => ({
    ...tool,
    descriptionOverride: overrides.get(tool.name),
  }))
}

type McpToolRowProps = {
  value: string
  tool: McpToolMetaFormValues
  clashing: boolean
  onChange: (descriptionOverride?: string) => void
}

function McpToolRow({ value, tool, clashing, onChange }: McpToolRowProps) {
  const overridden = tool.descriptionOverride !== undefined
  const description = tool.descriptionOverride ?? tool.description ?? ''

  return (
    <Accordion.Item value={value}>
      <Accordion.Trigger className="h-9 px-3 text-sm font-normal">
        <span
          className={cn('flex-1 text-left', clashing && 'text-destructive')}
        >
          {tool.name}
        </span>
      </Accordion.Trigger>
      <Accordion.Content className="flex flex-col gap-1.5 px-3">
        {clashing && (
          <span className="text-destructive text-sm">
            Conflict: another enabled tool resolves to the same name. Only one
            will be used.
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
            onClick={() => onChange(undefined)}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset
          </RippleButton>
        </div>
        <Textarea
          value={description}
          placeholder="No description provided"
          onChange={(e) => onChange(e.target.value)}
          className="max-h-48 min-h-20 text-sm"
        />
      </Accordion.Content>
    </Accordion.Item>
  )
}
