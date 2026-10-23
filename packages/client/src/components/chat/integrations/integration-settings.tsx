import { MarkdownRenderer } from '@/components/markdown/renderer'
import { HelpDialogButton, SearchInput } from '@/components/ui'
import { useIntegrationSettings } from '@/hooks/chat/integration-settings'
import { INTEGRATION_GUIDE } from '@sb/core/integrations/guide'
import { useState } from 'react'

import { IntegrationCard } from './integration-card'
import { IntegrationLink } from './integration-link'

export function IntegrationSettings() {
  const { admin, rows, busy, linkFeedback, cardFeedback, command, link, skills } = useIntegrationSettings() // prettier-ignore
  const [search, setSearch] = useState('')
  const needle = search.trim().toLocaleLowerCase()
  const matches = rows?.filter((row) =>
    [row.name, row.root].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  )

  if (!admin) {
    return (
      <p className="p-4 text-sm">
        Local integrations are available to administrators.
      </p>
    )
  }
  return (
    <section
      className="flex flex-col gap-4 p-3"
      aria-label="Integrations settings"
    >
      <div className="flex items-center gap-1.5">
        <p className="text-muted-foreground text-sm">
          Link a toolkit containing{' '}
          <code className="text-xs">.agents/integration.json</code>.
        </p>
        <HelpDialogButton
          title="Using integrations"
          triggerLabel="About integrations"
        >
          <MarkdownRenderer>{INTEGRATION_GUIDE}</MarkdownRenderer>
        </HelpDialogButton>
      </div>
      <IntegrationLink
        busy={busy}
        feedback={linkFeedback}
        onLink={(root) => void link(root)}
      />
      <SearchInput
        aria-label="Search toolkits"
        placeholder="Search toolkits…"
        value={search}
        onValueChange={setSearch}
      />
      {!!rows?.length && matches?.length === 0 && (
        <p className="text-muted-foreground text-sm">No toolkits found.</p>
      )}
      {matches?.map((row) => (
        <IntegrationCard
          key={row._id}
          row={row}
          busy={busy}
          feedback={cardFeedback[row._id]}
          onCommand={(action) => command(row, action)}
          onSkills={(enabled, disabled, name) =>
            void skills(row, enabled, disabled, name)
          }
        />
      ))}
    </section>
  )
}
