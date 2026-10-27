import { McpProtocolBrowser } from '@/components/chat/entities/user/mcp-protocol-browser'
import { McpResultContent } from '@/components/chat/messages/tools/mcp-result-content'
import '@/globals.css'
import {
  insertComposerText,
  listenForComposerInsertion,
} from '@/lib/chat/composer-insert'
import type { McpProtocolRequest } from '@sb/core/types/mcp-protocol'
import { type McpResult, mcpResult } from '@sb/core/types/mcp-result'
import { useEffect, useState } from 'react'

import { McpToolFixture } from './mcp-tool-fixture'

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const mixed = mcpResult(
  {
    content: [
      {
        type: 'text',
        text: '<script>window.fixtureInjected = true</script> λ😀',
      },
      { type: 'image', mimeType: 'image/png', data: image },
      { type: 'audio', mimeType: 'audio/wav', data: 'UklGRg==' },
      {
        type: 'resource',
        resource: {
          uri: 'fixture://embedded',
          text: 'Embedded resource output',
        },
      },
      {
        type: 'resource_link',
        uri: 'https://never-fetch.invalid/output',
        name: 'Linked output',
      },
      { type: 'future-block', payload: 'Preserved unknown format' },
    ],
    structuredContent: { finding: 42 },
    isError: true,
    _meta: { trace: 'browser' },
  },
  { serverId: 'fixture', name: 'mixed', operationId: 'one' },
)

export function McpProtocolFixture() {
  return new URLSearchParams(location.search).get('view') === 'tool' ? (
    <McpToolFixture />
  ) : (
    <ProtocolBrowserFixture />
  )
}

function ProtocolBrowserFixture() {
  const [output, setOutput] = useState<McpResult>()
  const [requests, setRequests] = useState<McpProtocolRequest[]>([])
  const [message, setMessage] = useState('')
  useEffect(
    () =>
      listenForComposerInsertion((text) => {
        setMessage(text)
        return true
      }),
    [],
  )
  function request(input: McpProtocolRequest) {
    setRequests((previous) => [...previous, input])
    const response =
      input.method === 'list_prompts'
        ? {
            prompts: Array.from({ length: 30 }, (_, i) => ({
              name: `prompt-${i}`,
            })),
          }
        : input.method === 'get_prompt'
          ? {
              messages: [
                {
                  role: 'user',
                  content: { type: 'text', text: 'Analyze {{ literal }}' },
                },
              ],
            }
          : input.method === 'list_resource_templates'
            ? {
                resourceTemplates: [
                  { name: 'Target', uriTemplate: 'fixture://target/{id}' },
                ],
              }
            : input.method === 'list_resources'
              ? { resources: [{ name: 'Output', uri: 'fixture://output' }] }
              : {
                  contents: [
                    { uri: input.uri, text: 'Requested resource output' },
                  ],
                }
    setOutput(
      mcpResult(
        { content: [], ...response },
        { serverId: 'fixture', name: input.method },
      ),
    )
  }
  return (
    <main className="bg-background text-foreground min-h-screen p-4">
      <div className="flex max-w-2xl flex-col gap-4">
        <McpProtocolBrowser
          output={output}
          onRequest={request}
          initialization="{{ instructions_are_literal }}"
          onInsert={(value) =>
            insertComposerText(JSON.stringify(value.result.messages))
          }
        />
        <output aria-label="Protocol requests">
          {JSON.stringify(requests)}
        </output>
        <textarea
          aria-label="Message composer"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <McpResultContent output={mixed} />
      </div>
    </main>
  )
}
