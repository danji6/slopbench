import { SearchInput, SettingsSwitch } from '@/components/ui'
import { useIntegrationSelection } from '@/hooks/chat/integration-selection'
import type { IntegrationSelectionContext } from '@/hooks/chat/integration-selection'
import { useState } from 'react'

/** Presents a searchable list of integrations selected for an agent. */
export function IntegrationSelection({ agentId }: IntegrationSelectionContext) {
  const { admin, rows, error, saving, change } = useIntegrationSelection({ agentId }) // prettier-ignore
  const [search, setSearch] = useState('')
  const needle = search.trim().toLocaleLowerCase()
  const matches = rows?.filter((row) => row.name.toLocaleLowerCase().includes(needle)) // prettier-ignore

  if (!admin) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Local integrations are available to administrators.
      </p>
    )
  }
  if (!agentId) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Save this agent before selecting integrations.
      </p>
    )
  }
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4"
      aria-label="Integration selection"
    >
      <p className="text-muted-foreground text-xs">
        Select the integrations this agent can use. Subagents can only use
        integrations available to their parent.
      </p>
      <SearchInput
        aria-label="Search integration names"
        placeholder="Search integration names…"
        value={search}
        onValueChange={setSearch}
      />
      <div
        role="list"
        aria-label="Agent integrations"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {matches?.map((row) => (
          <div
            key={row._id}
            role="listitem"
            className="border-border border-b py-3"
          >
            <SettingsSwitch
              reserveActionSpace={false}
              label={row.name}
              checked={row.selected}
              disabled={saving}
              onCheckedChange={(on) => void change(row._id, on)}
              help="Allow this agent to use the integration’s tools and skills."
            />
          </div>
        ))}
        {!rows && (
          <p role="status" className="text-muted-foreground text-sm">
            Loading integrations…
          </p>
        )}
        {rows?.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Link a toolkit in Settings → Integrations.
          </p>
        )}
        {!!rows?.length && matches?.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No integrations found.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  )
}
