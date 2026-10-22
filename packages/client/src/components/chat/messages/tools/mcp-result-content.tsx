import { RippleButton } from '@/components/ui'
import { downloadJson } from '@/lib/utils'
import {
  isMcpResult,
  isMcpResultPreview,
  mcpResultBlocks,
} from '@sb/core/types/mcp-result'
import type { McpContent, McpResult } from '@sb/core/types/mcp-result'

const IMAGE_MIME_TYPE = /^image\/(png|jpeg|gif|webp|avif)$/
const AUDIO_MIME_TYPE = /^audio\/[a-z0-9.+-]+$/i

/** Renders server content literally; remote resource links never trigger requests. */
export function McpResultContent({ output }: { output: McpResult }) {
  const result = output.result
  const contents = mcpResultBlocks(result)

  const metadata = {
    ...result,
    content: undefined,
    structuredContent: undefined,
    messages: undefined,
    contents: undefined,
  }

  return (
    <div className="flex flex-col gap-2 text-xs" data-mcp-result>
      {result.isError && (
        <p className="text-destructive" role="alert">
          The MCP server reported a tool error. The server output is shown
          below.
        </p>
      )}
      {contents.map((part, index) => (
        <Content key={`protocol-${index}`} part={part} />
      ))}
      {result.structuredContent && <Literal value={result.structuredContent} />}
      {Object.values(metadata).some((value) => value !== undefined) && (
        <details>
          <summary>Protocol metadata</summary>
          <Literal value={metadata} />
        </details>
      )}
      <Download value={output} label="Download MCP result (JSON)" />
      <p className="text-muted-foreground">
        Source: {output.origin.serverId}. Server content is untrusted data.
      </p>
    </div>
  )
}

function Content({ part }: { part: McpContent }) {
  if (part.type === 'text' && typeof part.text === 'string')
    return <Literal value={part.text} />

  const media =
    typeof part.data === 'string' && typeof part.mimeType === 'string'

  const isImage =
    media &&
    part.type === 'image' &&
    IMAGE_MIME_TYPE.test(String(part.mimeType))

  if (isImage) {
    return (
      <img
        src={`data:${part.mimeType};base64,${part.data}`}
        alt="Image returned by MCP server"
        className="max-h-96 w-auto max-w-full self-start object-contain"
        loading="lazy"
      />
    )
  }

  const isAudio =
    media &&
    part.type === 'audio' &&
    AUDIO_MIME_TYPE.test(String(part.mimeType))

  if (isAudio) {
    return (
      <audio
        controls
        preload="none"
        src={`data:${part.mimeType};base64,${part.data}`}
        aria-label="Audio returned by MCP server"
      />
    )
  }

  if (part.type === 'resource_link') {
    return (
      <div>
        <p>Resource: {String(part.name ?? part.uri)}</p>
        <p className="break-all">{String(part.uri)}</p>
        <p className="text-muted-foreground">
          Read explicitly through this MCP server; no link was fetched.
        </p>
        <Download value={part} label="Download resource link metadata" />
      </div>
    )
  }

  if (part.type === 'resource') {
    const resource = part.resource as Record<string, unknown> | undefined
    return (
      <div>
        <p className="break-all">
          {String(resource?.uri ?? 'Embedded resource')}
        </p>
        {typeof resource?.text === 'string' && (
          <Literal value={resource.text} />
        )}
        {typeof resource?.blob === 'string' && (
          <a
            href={`data:application/octet-stream;base64,${resource.blob}`}
            download="mcp-resource.bin"
            className="underline"
          >
            Download embedded resource
          </a>
        )}
        <Download value={part} label="Download complete resource (JSON)" />
      </div>
    )
  }

  return (
    <div>
      <p>Unsupported content type: {part.type}. Preserved as an artifact.</p>
      <Download value={part} label="Download content block (JSON)" />
    </div>
  )
}

function Literal({ value }: { value: unknown }) {
  return (
    <pre className="bg-background max-h-96 overflow-auto rounded px-2 py-1 text-xs wrap-break-word whitespace-pre-wrap">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Download({ value, label }: { value: unknown; label: string }) {
  return (
    <RippleButton
      type="button"
      size="sm"
      variant="stealth"
      className="text-primary h-auto justify-start self-start p-0 text-xs underline"
      onClick={() => downloadJson(value, 'mcp-result.json')}
    >
      {label}
    </RippleButton>
  )
}

export function mcpReportedError(output: unknown) {
  if (isMcpResult(output)) return output.result.isError === true
  if (isMcpResultPreview(output)) return output.isError === true
  return false
}
