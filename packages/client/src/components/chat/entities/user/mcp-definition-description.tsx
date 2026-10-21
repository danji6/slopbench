import { useMcpDefinition } from '@/hooks/chat/mcp-definition'

import { McpToolDescription } from './mcp-tool-description'

type Props = {
  name: string
  url: string | null | undefined
  override?: string
  onChange: (value: string | undefined) => void
}

/** Loads the original only while its expanded tool editor is mounted. */
export function McpDefinitionDescription({
  name,
  url,
  override,
  onChange,
}: Props) {
  const { description, loading, error, retry } = useMcpDefinition(url, name)
  return (
    <div className="flex flex-col gap-1.5">
      <McpToolDescription
        description={description}
        override={override}
        onChange={onChange}
        loading={loading}
        error={error}
        onRetry={url ? retry : undefined}
      />
      {url && (
        <a
          className="text-primary text-xs underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Download tool definition (JSON)
        </a>
      )}
    </div>
  )
}
