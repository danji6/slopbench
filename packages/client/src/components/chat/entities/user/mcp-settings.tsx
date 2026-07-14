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
import { useTools } from '@/hooks/chat'
import { cn, generateId } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import {
  type McpTransport,
  SUPPORTED_MCP_TRANSPORTS,
  mcpToolName,
} from '@sb/core/types'
import { useAction } from 'convex/react'
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
import { Controller } from 'react-hook-form'

import type {
  McpServerFormValues,
  McpToolMetaFormValues,
  SettingsFormValues,
} from './settings-schema'

type McpSettingsProps = {
  control: Control<SettingsFormValues>
}

export function McpSettings({ control }: McpSettingsProps) {
  return (
    <SettingsList className="pb-4">
      <Controller
        control={control}
        name="mcpServers"
        render={({ field }) => (
          <SettingsList.Item
            label="MCP servers"
            description="Connect external Model Context Protocol servers."
            unclickable
            unhoverable
            orientation="vertical"
          >
            <McpServerList servers={field.value} onChange={field.onChange} />
          </SettingsList.Item>
        )}
      />
    </SettingsList>
  )
}

type McpServerListProps = {
  servers: McpServerFormValues[]
  onChange: (servers: McpServerFormValues[]) => void
}

type McpServerItem = McpServerFormValues & { index: number }

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

function McpServerList({ servers, onChange }: McpServerListProps) {
  const items = servers.map((server, index) => ({ ...server, index }))
  const conflicts = useToolConflicts(servers)

  function handleAdd() {
    onChange([
      {
        id: generateId(),
        label: '',
        url: '',
        transport: 'sse',
        enabled: true,
      },
      ...servers,
    ])
  }

  function handleChange(index: number, patch: Partial<McpServerFormValues>) {
    onChange(
      servers.map((server, i) =>
        i === index ? { ...server, ...patch } : server,
      ),
    )
  }

  function handleDelete(index: number) {
    onChange(servers.filter((_, i) => i !== index))
  }

  function handleMove(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= servers.length) return
    const next = [...servers]
    const current = next[index]
    if (!current || !next[nextIndex]) return
    next[index] = next[nextIndex]
    next[nextIndex] = current
    onChange(next)
  }

  return (
    <SearchableList<McpServerItem>
      items={items}
      keys={(item) => item.id}
      fields={['label', 'url']}
      pageSize={10}
      searchThreshold={5}
      searchPlaceholder="Search servers..."
      actions={
        <RippleButton
          type="button"
          size="sm"
          variant="input"
          onClick={handleAdd}
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
          count={servers.length}
          conflicts={conflicts}
          onChange={handleChange}
          onDelete={handleDelete}
          onMove={handleMove}
        />
      )}
    />
  )
}

type McpServerCardProps = {
  item: McpServerItem
  count: number
  conflicts: Set<string>
  onChange: (index: number, patch: Partial<McpServerFormValues>) => void
  onDelete: (index: number) => void
  onMove: (index: number, direction: -1 | 1) => void
}

function McpServerCard({
  item,
  count,
  conflicts,
  onChange,
  onDelete,
  onMove,
}: McpServerCardProps) {
  const discover = useAction(api.actions.mcp.discoverMcpTools)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      const { tools } = await discover({
        url: item.url,
        transport: item.transport,
        apiKey: item.apiKey || undefined,
      })
      // Preserve user-authored description overrides across rediscovery
      const overrides = new Map(
        (item.tools ?? []).map((t) => [t.name, t.descriptionOverride]),
      )
      onChange(item.index, {
        tools: tools.map((t) => ({
          ...t,
          descriptionOverride: overrides.get(t.name),
        })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover tools')
    } finally {
      setRefreshing(false)
    }
  }

  function updateTool(name: string, patch: Partial<McpToolMetaFormValues>) {
    onChange(item.index, {
      tools: (item.tools ?? []).map((tool) =>
        tool.name === name ? { ...tool, ...patch } : tool,
      ),
    })
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
          onCheckedChange={(enabled) => onChange(item.index, { enabled })}
        />
        <Input
          value={item.label}
          placeholder="Label"
          onValueChange={(label) => onChange(item.index, { label })}
          className="h-8 flex-1"
        />
        {expanded && (
          <Combobox
            value={item.transport}
            onValueChange={(transport) =>
              onChange(item.index, { transport: transport as McpTransport })
            }
            noDeselect
          >
            <Combobox.Trigger
              variant="input"
              size="sm"
              className="h-8 w-32 shrink-0"
            >
              <Combobox.DisplayValue>
                {(transport) =>
                  SUPPORTED_MCP_TRANSPORTS.find((t) => t.id === transport)
                    ?.label ?? transport
                }
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
          onClick={() => onMove(item.index, -1)}
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
          onClick={() => onMove(item.index, 1)}
        >
          <ArrowDownIcon />
        </TooltipButton>
        <TooltipButton
          type="button"
          tooltip="Remove"
          size="icon"
          variant="stealth"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item.index)}
        >
          <Trash2Icon />
        </TooltipButton>
      </div>
      <Collapsible.Content className="p-0 pt-1.5">
        <div className="flex w-full items-center gap-2 px-1">
          <Input
            value={item.url}
            placeholder="http://localhost:11235/mcp/sse"
            onValueChange={(url) => onChange(item.index, { url })}
            className="h-9 flex-1"
          />
        </div>
        <div className="flex w-full items-center gap-2 px-1">
          <Input
            type="password"
            value={item.apiKey ?? ''}
            placeholder="API key (optional)"
            onValueChange={(apiKey) => onChange(item.index, { apiKey })}
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
            {item.tools.map((tool) => (
              <McpToolRow
                key={tool.name}
                value={tool.name}
                tool={tool}
                clashing={isClashing(tool)}
                onChange={(patch) => updateTool(tool.name, patch)}
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

type McpToolRowProps = {
  value: string
  tool: McpToolMetaFormValues
  clashing: boolean
  onChange: (patch: Partial<McpToolMetaFormValues>) => void
}

function McpToolRow({ value, tool, clashing, onChange }: McpToolRowProps) {
  const overridden = tool.descriptionOverride !== undefined

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
            onClick={() => onChange({ descriptionOverride: undefined })}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset
          </RippleButton>
        </div>
        <Textarea
          value={tool.descriptionOverride ?? tool.description ?? ''}
          placeholder="No description provided"
          onChange={(e) => onChange({ descriptionOverride: e.target.value })}
          className="max-h-48 min-h-20 text-sm"
        />
      </Accordion.Content>
    </Accordion.Item>
  )
}
