import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { useState } from 'react'

import {
  type CatalogDescriptionProps,
  McpCatalogPage,
} from './mcp-catalog-page'
import { McpDefinitionDescription } from './mcp-definition-description'
import type { McpToolMetaFormValues } from './settings-schema'

type Props = {
  serverId: Id<'mcpServers'>
  overrides?: McpToolMetaFormValues[]
  onChange: (tools: McpToolMetaFormValues[]) => void
}

/** Browses one revision in bounded pages and keeps user policies separate from definitions. */
export function McpCatalog({ serverId, overrides = [], onChange }: Props) {
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [revision, setRevision] = useState<Id<'mcpCatalogs'> | undefined>()

  const page = useQuery(api.mcpCatalogs.page, {
    serverId,
    catalogId: revision,
    paginationOpts: { cursor: cursors.at(-1) ?? null, numItems: 20 },
  })
  if (page?.catalogId && page.catalogId !== revision) {
    setRevision(page.catalogId)
    setCursors([null])
  }
  if (!page) {
    return (
      <p className="text-muted-foreground px-3 text-xs">Loading catalog…</p>
    )
  }

  return (
    <McpCatalogPage
      rows={page.page}
      error={page.error}
      overrides={overrides}
      onChange={onChange}
      pageNumber={cursors.length - 1}
      hasNext={!page.isDone}
      onPrevious={() => setCursors(cursors.slice(0, -1))}
      onNext={() => setCursors([...cursors, page.continueCursor])}
      renderDescription={(props) => (
        <CatalogDescription {...props} serverId={serverId} />
      )}
    />
  )
}

function CatalogDescription({
  serverId,
  row,
  override,
  onChange,
}: CatalogDescriptionProps & {
  serverId: Id<'mcpServers'>
}) {
  const url = useQuery(api.mcpCatalogs.definitionUrl, {
    serverId,
    toolId: row._id as Id<'mcpCatalogTools'>,
  })
  return (
    <McpDefinitionDescription
      name={row.name}
      url={url}
      override={override}
      onChange={onChange}
    />
  )
}
