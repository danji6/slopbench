import { Input, Textarea } from '@/components/ui'

import type { McpServerFormValues } from './settings-schema'

type Props = {
  item: McpServerFormValues
  onChange: (patch: Partial<McpServerFormValues>) => void
}

/** Edits explicit argv and environment values for a local process. */
export function McpLocalSettings({ item, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2 px-1">
      <Input
        aria-label="MCP command"
        value={item.command ?? ''}
        placeholder="Executable, e.g. npx"
        onValueChange={(command) => onChange({ command })}
      />
      <Textarea
        aria-label="MCP arguments"
        value={item.argsJson ?? '[]'}
        placeholder={'["-y", "package@version", "mcp"]'}
        onChange={(event) => onChange({ argsJson: event.target.value })}
      />
      <p className="text-muted-foreground text-xs">
        Arguments are a JSON array. Commands run without an implicit shell.
      </p>
      <Input
        aria-label="MCP working directory"
        value={item.cwd ?? ''}
        placeholder="Working directory (sidecar default if omitted)"
        onValueChange={(cwd) => onChange({ cwd: cwd || undefined })}
      />
      <Textarea
        aria-label="MCP environment"
        value={item.envJson ?? '{}'}
        placeholder="Nonsecret environment as a JSON object"
        onChange={(event) => onChange({ envJson: event.target.value })}
      />
      <Input
        type="password"
        aria-label="MCP secret environment"
        value={item.secretEnvJson ?? ''}
        placeholder={`Secret environment JSON (${item.secretEnvNames?.join(', ') || 'none saved'}); blank keeps saved values`}
        onValueChange={(secretEnvJson) =>
          onChange({ secretEnvJson: secretEnvJson || undefined })
        }
      />
      <p className="text-muted-foreground text-xs">
        Set a secret value to an empty string to remove it. Save changes before
        checking stored credentials.
      </p>
    </div>
  )
}
