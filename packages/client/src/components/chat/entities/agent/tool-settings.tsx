import { Input, Tabs } from '@/components/ui'
import { useTools } from '@/hooks/chat'
import type { ToolMetadata } from '@/lib/chat'
import { type RefObject, useLayoutEffect, useState } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { ShellSettings } from '../shell-settings'
import type { AgentFormValues } from './agent-form'
import { getEnabledToolNames, toToolSelection } from './agent-form'
import { AutoApproveSettings } from './auto-approve-settings'
import { ToolSelectionList } from './tool-selection-list'

export function ToolSettings({
  control,
  scrollContainerRef,
}: {
  control: Control<AgentFormValues>
  scrollContainerRef: RefObject<HTMLDivElement | null>
}) {
  const [tab, setTab] = useState('tools')

  useLayoutEffect(() => {
    // Reset the shared scroller before the newly selected panel paints.
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [tab, scrollContainerRef])

  const { tools: availableTools, isLoading } = useTools()
  const { field: toolsField } = useController({ control, name: 'tools' })
  const { field: shellField } = useController({ control, name: 'shell' })
  const enabled = new Set(getEnabledToolNames(toolsField.value, availableTools))
  const builtinTools = availableTools.filter((tool) => tool.category !== 'mcp')
  const mcpTools = availableTools.filter((tool) => tool.category === 'mcp')

  function toggleTools(tools: readonly ToolMetadata[]) {
    const allOn = tools.every((tool) => enabled.has(tool.name))
    const next = new Set(enabled)
    for (const { name } of tools) {
      if (allOn) next.delete(name)
      else next.add(name)
    }
    toolsField.onChange(toToolSelection(next, availableTools))
  }

  return (
    <Tabs variant="hug" value={tab} onValueChange={setTab} className="min-w-0">
      <Tabs.List
        aria-label="Tool settings"
        className="bg-background sticky top-0 z-20 shrink-0"
      >
        <Tabs.Trigger value="tools">Tools</Tabs.Trigger>
        <Tabs.Trigger value="mcp">MCP</Tabs.Trigger>
        <Tabs.Trigger value="approvals">Approvals</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Panels className="overflow-x-clip">
        <Tabs.Content value="tools">
          <ToolSelectionList
            tools={builtinTools}
            enabled={enabled}
            onToggle={toggleTools}
            label="All built-in tools"
            grouped
          />
        </Tabs.Content>
        <Tabs.Content value="mcp">
          <McpToolSettings
            tools={mcpTools}
            enabled={enabled}
            onToggle={toggleTools}
            isLoading={isLoading}
          />
        </Tabs.Content>
        <Tabs.Content value="allowlists">
          <ShellSettings
            override
            value={shellField.value}
            onChange={shellField.onChange}
          />
          <AutoApproveSettings control={control} />
        </Tabs.Content>
      </Tabs.Panels>
    </Tabs>
  )
}

function McpToolSettings({
  tools,
  enabled,
  onToggle,
  isLoading,
}: {
  tools: ToolMetadata[]
  enabled: Set<string>
  onToggle: (tools: readonly ToolMetadata[]) => void
  isLoading: boolean
}) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const filtered = tools.filter((tool) =>
    `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(query),
  )

  return (
    <>
      <div className="px-4 py-3">
        <Input
          type="search"
          aria-label="Search discovered MCP tools"
          placeholder="Search MCP tools…"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          variant="outline"
        />
      </div>
      {filtered.length > 0 ? (
        <ToolSelectionList
          tools={filtered}
          enabled={enabled}
          onToggle={onToggle}
          label={query ? 'All matching MCP tools' : 'All MCP tools'}
        />
      ) : (
        <p className="text-muted-foreground px-4 py-3 text-sm" role="status">
          {isLoading
            ? 'Loading MCP tools…'
            : tools.length === 0
              ? 'No MCP tools discovered.'
              : 'No MCP tools match your search.'}
        </p>
      )}
    </>
  )
}
