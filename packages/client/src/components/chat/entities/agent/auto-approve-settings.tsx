import { Button, Input, SettingsList } from '@/components/ui'
import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

/** Approval-gated tools an agent can be trusted to run unprompted. */
const APPROVAL_GATED_TOOLS = [
  { name: 'write_file', description: 'Create or overwrite files.' },
  { name: 'edit_file', description: 'Edit files.' },
]

export function AutoApproveSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const { field: toolsField } = useController({
    control,
    name: 'autoApproveTools',
  })
  const { field: shellField } = useController({
    control,
    name: 'autoApproveShell',
  })
  const [pattern, setPattern] = useState('')

  const tools = toolsField.value
  const patterns = shellField.value

  function toggleTool(name: string) {
    toolsField.onChange(
      tools.includes(name)
        ? tools.filter((tool) => tool !== name)
        : [...tools, name],
    )
  }

  function addPattern() {
    const trimmed = pattern.trim()
    if (!trimmed || patterns.includes(trimmed)) return
    shellField.onChange([...patterns, trimmed])
    setPattern('')
  }

  function removePattern(value: string) {
    shellField.onChange(patterns.filter((entry) => entry !== value))
  }

  return (
    <SettingsList>
      <SettingsList.Item
        label={<span className="font-semibold">Auto approve</span>}
        description="Actions this agent may take without your explicit approval."
        unclickable
        unhoverable
      />
      {APPROVAL_GATED_TOOLS.map((meta) => (
        <SettingsList.Checkbox
          key={meta.name}
          className="pl-8"
          label={meta.name}
          description={meta.description}
          checked={tools.includes(meta.name)}
          onCheckedChange={() => toggleTool(meta.name)}
        />
      ))}
      <SettingsList.Item
        className="pl-8"
        label="Shell commands"
        description="Command patterns this agent may run without approval, e.g. `find` or `git checkout`."
        orientation="vertical"
        unclickable
        unhoverable
      >
        <div className="flex gap-2">
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              addPattern()
            }}
            placeholder="git checkout"
            variant="outline"
            className="h-9 max-w-70 font-mono text-sm"
          />
          <Button
            type="button"
            variant="surface"
            size="icon"
            aria-label="Add pattern"
            disabled={!pattern.trim()}
            onClick={addPattern}
          >
            <PlusIcon />
          </Button>
        </div>
        {patterns.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {patterns.map((entry) => (
              <span
                key={entry}
                className="bg-m3-surface-container-high flex items-center gap-1.5 rounded-full py-1 pr-2 pl-3 font-mono text-xs"
              >
                {entry}
                <button
                  type="button"
                  aria-label={`Remove ${entry}`}
                  className="text-muted-foreground hover:text-foreground flex items-center transition-colors"
                  onClick={() => removePattern(entry)}
                >
                  <XIcon className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </SettingsList.Item>
    </SettingsList>
  )
}
