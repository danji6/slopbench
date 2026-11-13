import { MarkdownRenderer } from '@/components/markdown/renderer'
import { HelpDialogButton, SearchInput } from '@/components/ui'
import { useToolkitSettings } from '@/hooks/chat/toolkit-settings'
import { TOOLKIT_GUIDE } from '@cv/core/toolkits/guide'
import { useState } from 'react'

import { ToolkitCard } from './toolkit-card'
import { ToolkitLink } from './toolkit-link'

export function ToolkitSettings() {
  const { admin, rows, busy, linkFeedback, cardFeedback, command, link, skills } = useToolkitSettings() // prettier-ignore
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
        Local toolkits are available to administrators.
      </p>
    )
  }
  return (
    <section className="flex flex-col gap-4 p-3" aria-label="Toolkits settings">
      <div className="flex items-center gap-1.5">
        <p className="text-muted-foreground text-sm">
          Link a toolkit containing{' '}
          <code className="text-xs">.agents/toolkit.json</code>.
        </p>
        <HelpDialogButton title="Using toolkits" triggerLabel="About toolkits">
          <MarkdownRenderer>{TOOLKIT_GUIDE}</MarkdownRenderer>
        </HelpDialogButton>
      </div>
      <ToolkitLink
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
        <ToolkitCard
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
