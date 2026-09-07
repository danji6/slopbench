import { SettingsList } from '@/components/ui'
import { approvalPathsError } from '@sb/core/workspace/path-policy'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'
import { ApprovalList } from './approval-list'

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
  const { field: pathsField } = useController({
    control,
    name: 'autoApprovePaths',
  })

  const tools = toolsField.value

  function toggleTool(name: string) {
    toolsField.onChange(
      tools.includes(name)
        ? tools.filter((tool) => tool !== name)
        : [...tools, name],
    )
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
        <ApprovalList
          values={shellField.value}
          onChange={shellField.onChange}
          placeholder="git checkout"
          label="Command pattern"
        />
      </SettingsList.Item>
      <SettingsList.Item
        className="pl-8"
        label="Paths"
        description="Files and directories this agent may read or edit without approval, relative to the workspace."
        orientation="vertical"
        unclickable
        unhoverable
      >
        <ApprovalList
          values={pathsField.value ?? []}
          onChange={pathsField.onChange}
          placeholder="path"
          label="Path"
          validate={approvalPathsError}
        />
      </SettingsList.Item>
    </SettingsList>
  )
}
