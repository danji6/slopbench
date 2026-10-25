import { RippleButton, SearchableList, SettingsList } from '@/components/ui'
import { useTools } from '@/hooks/chat'
import { generateId } from '@/lib/utils'
import { mcpToolName } from '@sb/core/types'
import { PlusIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { Control } from 'react-hook-form'
import { useFieldArray } from 'react-hook-form'

import { McpServerCard, type McpServerItem } from './mcp-server-card'
import type { McpServerFormValues, SettingsFormValues } from './settings-schema'

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
      startupTimeoutMs: 30_000,
      requestTimeoutMs: 300_000,
      maxTotalTimeoutMs: 1_800_000,
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
          searchPlaceholder="Search servers…"
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
        const name = mcpToolName(server, tool)
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
