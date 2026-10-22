import { insertComposerText } from '@/lib/chat/composer-insert'
import { readTextPreview } from '@/lib/text-file-preview'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { MAX_MESSAGE_PART_BYTES } from '@sb/core/limits'
import type {
  McpProtocolCheckResult,
  McpProtocolRequest,
} from '@sb/core/types/mcp-protocol'
import { mcpProtocolRequestSchema } from '@sb/core/types/mcp-protocol'
import {
  MAX_MCP_RESULT_BYTES,
  mcpResultSchema,
} from '@sb/core/types/mcp-result'
import { useAction, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'

import { McpProtocolBrowser } from './mcp-protocol-browser'

type LoadedProtocolCheck = McpProtocolCheckResult & { url: string }

/** Keeps settings checks tied to reactive ownership/configuration access. */
export function McpProtocol({ serverId }: { serverId: Id<'mcpServers'> }) {
  const check = useAction(api.actions.mcpProtocol.check)
  const [checkId, setCheckId] = useState<Id<'mcpProtocolChecks'>>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState<LoadedProtocolCheck>()
  const sequence = useRef(0)
  const url = useQuery(api.mcpProtocol.check, checkId ? { checkId } : 'skip')

  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ])
    void readCheck(url, signal).then(
      (data) => {
        if (!controller.signal.aborted) setLoaded({ url, ...data })
      },
      () => {
        if (!controller.signal.aborted)
          setError(
            'Could not load the complete check result. Check the server again.',
          )
      },
    )
    return () => controller.abort()
  }, [url])

  async function request(input: McpProtocolRequest) {
    const attempt = ++sequence.current
    setPending(true)
    setError('')
    setCheckId(undefined)
    try {
      const id = await check({
        serverId,
        ...mcpProtocolRequestSchema.parse(input),
      })
      if (sequence.current === attempt) setCheckId(id)
    } catch (error) {
      if (sequence.current === attempt)
        setError(error instanceof Error ? error.message : 'MCP check failed')
    } finally {
      if (sequence.current === attempt) setPending(false)
    }
  }

  const current = loaded?.url === url ? loaded : undefined

  return (
    <McpProtocolBrowser
      onRequest={request}
      busy={pending || (!!checkId && !current && url !== null && !error)}
      error={
        error ||
        (url === null
          ? 'This check expired or its server configuration changed.'
          : '')
      }
      output={current?.output}
      initialization={current?.initialization}
      onInsert={(output) => {
        const text = `MCP prompt from ${serverId} (literal server content):\n${JSON.stringify(output.result.messages, null, 2)}`
        if (
          new TextEncoder().encode(JSON.stringify({ type: 'text', text }))
            .byteLength >
          MAX_MESSAGE_PART_BYTES - 1024
        ) {
          setError(
            'This prompt is too large for one message. Download the original JSON to inspect it.',
          )
          return
        }
        if (!insertComposerText(text))
          setError(
            'Open a chat with an editable message composer before inserting this prompt.',
          )
      }}
    />
  )
}

async function readCheck(
  url: string,
  signal: AbortSignal,
): Promise<McpProtocolCheckResult> {
  const preview = await readTextPreview(
    url,
    signal,
    MAX_MCP_RESULT_BYTES + 128 * 1024,
  )
  if (preview.truncated) throw new Error('Incomplete MCP check artifact')
  const data = JSON.parse(preview.text)
  return {
    output: mcpResultSchema.parse(data.output),
    initialization: String(data.initialization ?? ''),
  }
}
