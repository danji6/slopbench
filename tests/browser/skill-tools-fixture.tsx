import { ToolPartBlock } from '@/components/chat/messages/tools/tool-part-block'
import '@/globals.css'
import { StreamStoreProvider } from '@/hooks/chat/stream'
import type { ToolUIPart } from 'ai'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { useState } from 'react'

const client = new ConvexReactClient('https://fixture.convex.cloud', {
  unsavedChangesWarning: false,
})
const entries = Array.from({ length: 20 }, (_, index) => ({
  name: index === 19 ? `skill-${'long-name-'.repeat(16)}` : `skill-${index}`,
  description: 'Private skill description',
  absolutePath: '/private/agent-home/skills/example',
  path: 'agent://skills/example/SKILL.md',
}))

export function SkillToolsFixture() {
  const scenario = new URLSearchParams(location.search).get('scenario')
  const [pending, setPending] = useState(scenario === 'pending')
  const output = {
    entries: scenario === 'empty' ? [] : entries,
    cursor: null,
    isDone: true,
  }
  const part = {
    type: 'tool-list_skills',
    toolCallId: 'skills',
    input: { search: '' },
    ...(pending
      ? { state: 'input-available' }
      : scenario === 'error'
        ? { state: 'output-error', errorText: 'Could not list skills.' }
        : {
            state: 'output-available',
            output: scenario === 'serialized' ? JSON.stringify(output) : output,
          }),
  } as ToolUIPart

  return (
    <ConvexProvider client={client}>
      <StreamStoreProvider>
        <main className="mx-auto max-w-xl p-4">
          <ToolPartBlock part={part} messageId="fixture" />
          <ToolPartBlock
            part={{
              ...part,
              toolCallId: 'search',
              input: { search: '  game  ' },
            }}
            messageId="fixture"
          />
          {pending && <button onClick={() => setPending(false)}>Finish</button>}
        </main>
      </StreamStoreProvider>
    </ConvexProvider>
  )
}
