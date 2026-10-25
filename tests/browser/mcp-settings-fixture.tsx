import { McpBrokerSettings } from '@/components/chat/entities/user/mcp-broker-settings'
import { parseMcpLaunch } from '@/components/chat/entities/user/mcp-launch'
import { McpLocalSettings } from '@/components/chat/entities/user/mcp-local-settings'
import {
  McpServerCard,
  type McpServerItem,
} from '@/components/chat/entities/user/mcp-server-card'
import { McpTimeouts } from '@/components/chat/entities/user/mcp-timeouts'
import { mcpServerSchema } from '@/components/chat/entities/user/settings-schema'
import type { McpServerFormValues } from '@/components/chat/entities/user/settings-schema'
import { McpProgress } from '@/components/chat/messages/tools/mcp-progress'
import { RippleButton } from '@/components/ui'
import '@/globals.css'
import type { ConvexReactClient } from 'convex/react'
import { ConvexProvider } from 'convex/react'
import { useState } from 'react'

export function McpSettingsFixture() {
  const card = new URLSearchParams(location.search).get('view') === 'card'
  return card ? <ServerCardFixture /> : <LocalSettingsFixture />
}

const cardClient = {
  action: async () => ({ tools: [], transport: 'sse' }),
} as unknown as ConvexReactClient

function ServerCardFixture() {
  const [item, setItem] = useState<McpServerItem>({
    id: 'web',
    rhfKey: 'web',
    index: 0,
    label: 'web',
    url: 'http://127.0.0.1:11235/mcp/sse',
    transport: 'auto',
    enabled: true,
    hasKey: true,
    startupTimeoutMs: 30_000,
    requestTimeoutMs: 300_000,
    maxTotalTimeoutMs: 1_800_000,
  })
  const [action, setAction] = useState('')

  return (
    <ConvexProvider client={cardClient}>
      <main className="bg-background text-foreground min-h-screen p-4">
        <div className="max-w-xl">
          <McpServerCard
            item={item}
            count={2}
            conflicts={new Set()}
            onChange={(patch) =>
              setItem((previous) => ({ ...previous, ...patch }))
            }
            onMove={(direction) => setAction(`Move ${direction}`)}
            onRemove={() => setAction('Remove')}
          />
          <output aria-label="Card action">{action}</output>
        </div>
      </main>
    </ConvexProvider>
  )
}

function LocalSettingsFixture() {
  const [item, setItem] = useState<McpServerFormValues>({
    id: 'local',
    label: 'Local',
    url: '',
    transport: 'stdio',
    enabled: true,
    hasKey: false,
  })
  const [output, setOutput] = useState('')
  const [bounded, setBounded] = useState(false)
  function save() {
    const result = mcpServerSchema.safeParse(item)
    if (!result.success) {
      setOutput(result.error.issues.map((issue) => issue.message).join('\n'))
      return
    }
    const { secretEnv, ...launch } = parseMcpLaunch(result.data)
    setOutput(
      JSON.stringify({
        startupTimeoutMs: item.startupTimeoutMs,
        requestTimeoutMs: item.requestTimeoutMs,
        maxTotalTimeoutMs: item.maxTotalTimeoutMs,
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
        <McpTimeouts
          item={item}
          onChange={(patch) =>
            setItem((previous) => ({ ...previous, ...patch }))
          }
        />
        <McpBrokerSettings
          enabled={item.brokerEnabled ?? false}
          onChange={(brokerEnabled) =>
            setItem((previous) => ({ ...previous, brokerEnabled }))
          }
        />
        <McpProgress
          progress={{
            progress: 3,
            message: 'Analyzing',
            ...(bounded ? { total: 10 } : {}),
          }}
        />
        <RippleButton onClick={() => setBounded((previous) => !previous)}>
          Toggle progress total
        </RippleButton>
        <RippleButton onClick={save}>Validate connection</RippleButton>
        <output aria-label="Connection result">{output}</output>
      </div>
    </main>
  )
}
