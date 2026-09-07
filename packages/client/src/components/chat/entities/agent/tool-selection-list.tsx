import { SettingsList } from '@/components/ui'
import type { ToolMetadata } from '@/lib/chat'
import { Fragment } from 'react'

const CATEGORY_LABELS: Record<string, string> = {
  web: 'Web',
  workspace: 'Workspace',
}

function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

function groupByCategory(tools: readonly ToolMetadata[]) {
  const groups = new Map<string, ToolMetadata[]>()
  for (const tool of tools) {
    const key = tool.category ?? 'general'
    const list = groups.get(key) ?? []
    list.push(tool)
    groups.set(key, list)
  }
  return [...groups.entries()]
}

type ToolSelectionProps = {
  tools: readonly ToolMetadata[]
  enabled: ReadonlySet<string>
  onToggle: (tools: readonly ToolMetadata[]) => void
}

export function ToolSelectionList({
  tools,
  enabled,
  onToggle,
  label,
  grouped = false,
}: ToolSelectionProps & { label: string; grouped?: boolean }) {
  const groups: [string, readonly ToolMetadata[]][] = grouped
    ? groupByCategory(tools)
    : [['mcp', tools]]

  return (
    <SettingsList>
      <ToolGroupCheckbox
        label={label}
        tools={tools}
        enabled={enabled}
        onToggle={onToggle}
      />
      {groups.map(([category, tools]) => (
        <Fragment key={category}>
          {grouped && (
            <ToolGroupCheckbox
              label={categoryLabel(category)}
              tools={tools}
              enabled={enabled}
              onToggle={onToggle}
            />
          )}
          {tools.map((meta) => (
            <SettingsList.Checkbox
              key={meta.name}
              className="pl-8"
              label={<span className="break-all">{meta.name}</span>}
              description={
                meta.description && (
                  <span className="line-clamp-1" title={meta.description}>
                    {meta.description}
                  </span>
                )
              }
              checked={enabled.has(meta.name)}
              onCheckedChange={() => onToggle([meta])}
            />
          ))}
        </Fragment>
      ))}
    </SettingsList>
  )
}

function ToolGroupCheckbox({
  label,
  tools,
  enabled,
  onToggle,
}: ToolSelectionProps & { label: string }) {
  const enabledCount = tools.filter((tool) => enabled.has(tool.name)).length
  const allOn = tools.length > 0 && enabledCount === tools.length

  return (
    <SettingsList.Checkbox
      label={<span className="font-semibold">{label}</span>}
      checked={allOn}
      indeterminate={enabledCount > 0 && !allOn}
      disabled={tools.length === 0}
      onCheckedChange={() => onToggle(tools)}
    />
  )
}
