import { SettingsList } from '@/components/ui'
import { useTools } from '@/hooks/chat'
import type { ToolMetadata } from '@/lib/chat'
import { Fragment } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'
import { getEnabledToolNames, toToolSelection } from './agent-form'
import { AutoApproveSettings } from './auto-approve-settings'

const CATEGORY_LABELS: Record<string, string> = {
  web: 'Web',
  workspace: 'Workspace',
  mcp: 'MCP',
}

function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

function groupByCategory(
  tools: readonly ToolMetadata[],
): [string, ToolMetadata[]][] {
  const groups = new Map<string, ToolMetadata[]>()
  for (const tool of tools) {
    const key = tool.category ?? 'general'
    const list = groups.get(key) ?? []
    list.push(tool)
    groups.set(key, list)
  }
  return [...groups.entries()]
}

export function ToolSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const { tools: availableTools } = useTools()
  const { field: toolsField } = useController({ control, name: 'tools' })

  const enabled = new Set(getEnabledToolNames(toolsField.value, availableTools))

  function setEnabled(names: Iterable<string>) {
    toolsField.onChange(toToolSelection([...names], availableTools))
  }

  function toggleTool(name: string) {
    const next = new Set(enabled)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setEnabled(next)
  }

  function toggleCategory(tools: ToolMetadata[]) {
    const names = tools.map((tool) => tool.name)
    const allOn = names.every((name) => enabled.has(name))
    const next = new Set(enabled)
    for (const name of names) {
      if (allOn) next.delete(name)
      else next.add(name)
    }
    setEnabled(next)
  }

  function toggleAllTools() {
    const allOn =
      availableTools.length > 0 &&
      availableTools.every((tool) => enabled.has(tool.name))
    setEnabled(allOn ? [] : availableTools.map((tool) => tool.name))
  }

  const enabledCount = availableTools.filter((tool) =>
    enabled.has(tool.name),
  ).length

  const allToolsOn =
    availableTools.length > 0 && enabledCount === availableTools.length

  return (
    <>
      <SettingsList>
        <SettingsList.Checkbox
          label={<span className="font-semibold">All tools</span>}
          checked={allToolsOn}
          indeterminate={enabledCount > 0 && !allToolsOn}
          onCheckedChange={toggleAllTools}
        />
        {groupByCategory(availableTools).map(([category, tools]) => {
          const enabledCount = tools.filter((tool) =>
            enabled.has(tool.name),
          ).length
          const allOn = enabledCount === tools.length

          return (
            <Fragment key={category}>
              <SettingsList.Checkbox
                label={
                  <span className="font-semibold">
                    {categoryLabel(category)}
                  </span>
                }
                checked={allOn}
                indeterminate={enabledCount > 0 && !allOn}
                onCheckedChange={() => toggleCategory(tools)}
              />
              {tools.map((meta) => (
                <SettingsList.Checkbox
                  key={meta.name}
                  className="pl-8"
                  label={meta.name}
                  description={
                    meta.description && (
                      <span className="line-clamp-1" title={meta.description}>
                        {meta.description}
                      </span>
                    )
                  }
                  checked={enabled.has(meta.name)}
                  onCheckedChange={() => toggleTool(meta.name)}
                />
              ))}
            </Fragment>
          )
        })}
      </SettingsList>
      <AutoApproveSettings control={control} />
    </>
  )
}
