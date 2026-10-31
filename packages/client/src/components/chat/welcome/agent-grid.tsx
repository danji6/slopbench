import { Input, RippleButton } from '@/components/ui'
import { type AgentSummary, useSelectAgent } from '@/hooks/chat/agent'
import { useAgentEditorView } from '@/hooks/chat/agent-editor'
import { useAgentPage } from '@/hooks/chat/agent-page'
import { startNewAgent } from '@/lib/chat/agent-editor-store'
import { toastError } from '@/lib/notifications'
import { SearchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { WelcomeAgentCards } from './agent-cards'

export function WelcomeAgentGrid() {
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <section
      data-slot="welcome-agent-grid"
      className="w-full space-y-6"
      aria-label="Choose an agent"
    >
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-medium text-balance">
          Who would you like to work with?
        </h1>
        <p className="text-muted-foreground text-sm">
          Choose an agent to get started.
        </p>
      </header>
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          aria-label="Search agents"
          placeholder="Search agents…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full pl-10"
        />
      </div>
      <AgentResults
        key={term}
        search={term}
        searching={search.trim() !== term}
      />
    </section>
  )
}

function AgentResults({
  search,
  searching,
}: {
  search: string
  searching: boolean
}) {
  const { agents, loading, hasMore, expanded, loadMore } = useAgentPage(search)
  const select = useSelectAgent()
  const [selectingAgents, setSelectingAgents] = useState<AgentSummary[] | null>(null) // prettier-ignore
  const pending = selectingAgents !== null
  const editor = useAgentEditorView()
  const loadingAgents = loading || searching
  const pageActionLabel =
    !search && !expanded ? 'View all agents' : 'Load more agents'

  async function choose(id: string) {
    if (pending || searching) return
    // Keep recency updates from moving the pressed card during selection and exit.
    setSelectingAgents(agents)
    try {
      await select(id)
    } catch (error) {
      setSelectingAgents(null)
      toastError(error, 'Could not select agent')
    }
  }

  if (!agents.length && !loading && !searching) {
    return (
      <div className="space-y-3 text-center" role="status">
        <p className="text-muted-foreground text-sm">
          {search
            ? 'No agents match your search.'
            : 'Create your first agent to get started.'}
        </p>
        {!search && (
          <RippleButton
            onClick={() => {
              startNewAgent()
              editor.open('profile')
            }}
          >
            Create an agent
          </RippleButton>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" aria-busy={loadingAgents}>
      <WelcomeAgentCards
        agents={selectingAgents ?? agents}
        disabled={pending || searching}
        onChoose={(id) => void choose(id)}
      />
      <div className="flex min-h-10 items-center justify-center">
        {(hasMore || loadingAgents) && (
          <RippleButton
            variant="stealth"
            disabled={loadingAgents || pending}
            onClick={loadMore}
          >
            {loadingAgents ? 'Loading agents…' : pageActionLabel}
          </RippleButton>
        )}
        <span role="status" className="sr-only">
          {loadingAgents && 'Loading agents…'}
        </span>
      </div>
    </div>
  )
}
