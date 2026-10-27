import { EMPTY_AGENT_FORM } from '@/components/chat/entities/agent/agent-form'
import type { AgentFormValues } from '@/components/chat/entities/agent/agent-form'
import { ToolSettings } from '@/components/chat/entities/agent/tool-settings'
import '@/globals.css'
import { TOOL_CAPABILITIES } from '@sb/core/tool-capabilities'
import type { ConvexReactClient } from 'convex/react'
import { ConvexProvider } from 'convex/react'
import { getFunctionName } from 'convex/server'
import { useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'

const metadata = [
  ...TOOL_CAPABILITIES,
  {
    name: 'docs_lookup',
    label: 'Docs lookup',
    category: 'mcp',
    description: 'An external MCP tool.',
  },
]
const client = {
  watchQuery(reference: Parameters<typeof getFunctionName>[0]) {
    return {
      onUpdate: () => () => {},
      localQueryResult: () =>
        getFunctionName(reference) === 'tools:list' ? metadata : undefined,
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
} as unknown as ConvexReactClient

export function ToolSettingsFixture() {
  const saved = localStorage.getItem('tool-settings-fixture')
  const { control, getValues } = useForm<AgentFormValues>({
    defaultValues: {
      ...EMPTY_AGENT_FORM,
      tools: saved ? JSON.parse(saved) : [],
    },
  })
  const selection = useWatch({ control, name: 'tools' })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  return (
    <ConvexProvider client={client}>
      <main ref={scrollContainerRef} className="mx-auto max-w-xl p-4">
        <ToolSettings
          control={control}
          scrollContainerRef={scrollContainerRef}
        />
        <button
          onClick={() =>
            localStorage.setItem(
              'tool-settings-fixture',
              JSON.stringify(getValues('tools')),
            )
          }
        >
          Save selection
        </button>
        <output aria-label="Saved selection">
          {JSON.stringify(selection)}
        </output>
      </main>
    </ConvexProvider>
  )
}
