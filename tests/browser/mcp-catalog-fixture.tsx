import { McpCatalogPage } from '@/components/chat/entities/user/mcp-catalog-page'
import { McpDefinitionDescription } from '@/components/chat/entities/user/mcp-definition-description'
import type { McpToolMetaFormValues } from '@/components/chat/entities/user/settings-schema'
import { RippleButton } from '@/components/ui'
import '@/globals.css'
import { useState } from 'react'

import { catalogTools as tools } from './mcp-catalog-data'

export function McpCatalogFixture() {
  const [page, setPage] = useState(0)
  const [overrides, setOverrides] = useState<McpToolMetaFormValues[]>([
    {
      name: 'tool_120',
      description: 'Stale description from a legacy catalog',
    },
  ])
  const [error, setError] = useState<string>()
  return (
    <main className="bg-background text-foreground min-h-screen max-w-lg p-4">
      <McpCatalogPage
        rows={tools.slice(page * 20, page * 20 + 20)}
        pageNumber={page}
        hasNext={(page + 1) * 20 < tools.length}
        onNext={() => setPage(page + 1)}
        onPrevious={() => setPage(page - 1)}
        error={error}
        overrides={overrides}
        onChange={setOverrides}
        renderDescription={({ row, override, onChange }) => (
          <McpDefinitionDescription
            name={row.name}
            url={`/mcp-definitions/${row._id}.json`}
            override={override}
            onChange={onChange}
          />
        )}
      />
      <RippleButton onClick={() => setError('Continuation page failed')}>
        Simulate failed refresh
      </RippleButton>
      <output aria-label="Catalog policy">{JSON.stringify(overrides)}</output>
    </main>
  )
}
