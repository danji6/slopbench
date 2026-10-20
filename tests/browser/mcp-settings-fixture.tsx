import { parseMcpLaunch } from '@/components/chat/entities/user/mcp-launch'
import { McpLocalSettings } from '@/components/chat/entities/user/mcp-local-settings'
import { mcpServerSchema } from '@/components/chat/entities/user/settings-schema'
import type { McpServerFormValues } from '@/components/chat/entities/user/settings-schema'
import { RippleButton } from '@/components/ui'
import '@/globals.css'
import { useState } from 'react'

export function McpSettingsFixture() {
  const [item, setItem] = useState<McpServerFormValues>({
    id: 'local',
    label: 'Local',
    url: '',
    transport: 'stdio',
    enabled: true,
    hasKey: false,
  })
  const [output, setOutput] = useState('')
  function save() {
    const result = mcpServerSchema.safeParse(item)
    if (!result.success) {
      setOutput(result.error.issues.map((issue) => issue.message).join('\n'))
      return
    }
    const { secretEnv, ...launch } = parseMcpLaunch(result.data)
    setOutput(
      JSON.stringify({
        command: item.command,
        cwd: item.cwd,
        ...launch,
        secretNames: Object.keys(secretEnv ?? {}),
      }),
    )
  }
  return (
    <main className="bg-background text-foreground min-h-screen p-4">
      <div className="flex max-w-lg flex-col gap-4">
        <McpLocalSettings
          item={item}
          onChange={(patch) =>
            setItem((previous) => ({ ...previous, ...patch }))
          }
        />
        <RippleButton onClick={save}>Validate connection</RippleButton>
        <output aria-label="Connection result">{output}</output>
      </div>
    </main>
  )
}
