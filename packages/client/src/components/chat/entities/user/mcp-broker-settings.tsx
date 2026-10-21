import { md } from '@/components/markdown'
import { SettingsSwitch } from '@/components/ui'

type Props = {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

/** Explains on-demand tool discovery without requiring MCP terminology. */
export function McpBrokerSettings({ enabled, onChange }: Props) {
  return (
    <SettingsSwitch
      label="Exclude tools from context"
      checked={enabled}
      onCheckedChange={onChange}
      help={md`
        When on, the agent searches this server’s tools and loads their
        instructions only when needed. This keeps its starting context
        smaller and is useful for servers with many tools.
        When off, you select individual tools and their instructions are
        included directly in the context.

        Select this server in the agent’s MCP tools to allow search access.
      `}
    />
  )
}
