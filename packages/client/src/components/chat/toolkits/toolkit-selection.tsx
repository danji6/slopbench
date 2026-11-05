import { RippleButton, SearchInput, SelectionListItem } from '@/components/ui'
import { useToolkitSelection } from '@/hooks/chat/toolkit-selection'
import type { ToolkitSelectionContext } from '@/hooks/chat/toolkit-selection'
import { useState } from 'react'

/** Presents a searchable list of toolkits selected for an agent. */
export function ToolkitSelection({ agentId }: ToolkitSelectionContext) {
  const { admin, rows, error, saving, change } = useToolkitSelection({ agentId }) // prettier-ignore
  const [search, setSearch] = useState('')
  const needle = search.trim().toLocaleLowerCase()
  const matches = rows?.filter((row) => row.name.toLocaleLowerCase().includes(needle)) // prettier-ignore

  if (!admin) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Local toolkits are available to administrators.
      </p>
    )
  }
  if (!agentId) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Save this agent before selecting toolkits.
      </p>
    )
  }
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4"
      aria-label="Toolkit selection"
    >
      <SearchInput
        aria-label="Search toolkits"
        placeholder="Search toolkits…"
        value={search}
        onValueChange={setSearch}
      />
      <div
        role="list"
        aria-label="Agent toolkits"
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {matches?.map((row) => (
          <SelectionListItem
            key={row._id}
            label={row.name}
            added={row.selected}
            description={row.description}
            actions={
              <>
                <RippleButton
                  size="sm"
                  variant="input"
                  disabled={saving || row.selected}
                  onClick={() => void change(row._id, true)}
                >
                  Add
                </RippleButton>
                {row.selected && (
                  <RippleButton
                    size="sm"
                    variant="input"
                    disabled={saving}
                    onClick={() => void change(row._id, false)}
                  >
                    Remove
                  </RippleButton>
                )}
              </>
            }
          />
        ))}
        {!rows && (
          <p role="status" className="text-muted-foreground text-sm">
            Loading toolkits…
          </p>
        )}
        {rows?.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Link a toolkit in Settings → Toolkits.
          </p>
        )}
        {!!rows?.length && matches?.length === 0 && (
          <p className="text-muted-foreground text-sm">No toolkits found.</p>
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
