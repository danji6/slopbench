import { Input, Popover, RippleButton } from '@/components/ui'
import { useDebouncedCallback } from '@/hooks'
import { useSessionSearch } from '@/hooks/chat/sessions'
import { SESSION_SEARCH_FILTERS } from '@sb/core/session-search/filters'
import { CircleHelpIcon } from 'lucide-react'
import { useState } from 'react'

const SEARCH_DEBOUNCE = 250

export function SessionSearch() {
  const setSearch = useSessionSearch()
  const commitSearch = useDebouncedCallback(setSearch, SEARCH_DEBOUNCE)
  const [query, setQuery] = useState('')

  return (
    <div className="flex items-center gap-1">
      <Input
        placeholder="Search…"
        aria-label="Search sessions"
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          commitSearch.run(value)
        }}
        className="border-input/50 h-10"
      />
      <SessionSearchHelp />
    </div>
  )
}

function SessionSearchHelp() {
  return (
    <Popover>
      <Popover.Trigger
        render={
          <RippleButton
            variant="stealth"
            size="icon"
            aria-label="Search filter help"
            className="text-muted-foreground"
          >
            <CircleHelpIcon />
          </RippleButton>
        }
      />
      <Popover.Content align="end" className="w-80 gap-3 p-4 text-sm">
        <Popover.Title className="font-semibold">Search filters</Popover.Title>
        <p>Narrow results with filters:</p>
        <dl className="grid gap-2">
          {Object.entries(SESSION_SEARCH_FILTERS).map(([key, filter]) => (
            <div key={key}>
              <dt className="font-mono text-xs">{filter.example}</dt>
              <dd className="text-muted-foreground">{filter.description}</dd>
            </div>
          ))}
        </dl>
        <p>
          Separate keywords with commas (OR logic):
          <br />
          <code className="text-xs">agent:Code,Explore</code>
          <br />
          <br />
          Repeat a filter to require both:
          <br />
          <code className="text-xs">agent:Alice agent:Bob</code>
        </p>
        <p>
          Use quotes to preserve spaces:
          <br />
          <code className="text-xs">agent:"Codebase Explorer"</code>
          <br />
          <br />
          Escape quotes with <code className="text-xs">{'\\"'}</code>:
          <br />
          <code className="text-xs">{'agent:"Alice \\"The Architect\\""'}</code>
          .
        </p>
      </Popover.Content>
    </Popover>
  )
}
