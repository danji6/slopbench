import { AgentFiles } from '@/components/chat/skills/agent-files'
import { AgentSkills } from '@/components/chat/skills/agent-skills'
import { SkillLibrary } from '@/components/chat/skills/skill-library'
import '@/globals.css'
import type { Id } from '@sb/convex/_generated/dataModel'
import { ConvexProvider } from 'convex/react'
import { useState } from 'react'

import {
  failNextSkillOperation,
  latestSkillOperation,
  removeFixtureHome,
  setFixtureHome,
  skillsFixtureClient,
} from './skills-client'

/** Production settings components with an isolated reactive backend fixture. */
export function SkillsFixture() {
  const [view, setView] = useState('agent')
  const [tab, setTab] = useState('skills')
  const [operation, setOperation] = useState('')
  return (
    <ConvexProvider client={skillsFixtureClient}>
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">
          Personal agent files — browser fixture
        </h1>
        <nav className="flex gap-4 py-4">
          <button onClick={() => setView('agent')}>Agent settings</button>
          <button onClick={() => setView('library')}>Skill library</button>
          <button
            onClick={() => setOperation(JSON.stringify(latestSkillOperation()))}
          >
            Inspect last operation
          </button>
        </nav>
        <button onClick={failNextSkillOperation}>Fail next operation</button>
        <button onClick={() => setFixtureHome(true)}>
          Assign managed fixture folder
        </button>
        <button onClick={() => setFixtureHome(false)}>
          Assign custom fixture folder
        </button>
        <button onClick={removeFixtureHome}>
          Remove fixture folder on disk
        </button>
        <output aria-label="Last operation">{operation}</output>
        {view === 'agent' ? (
          <>
            <button onClick={() => setTab('skills')}>Skills</button>
            <button onClick={() => setTab('files')}>Files</button>
            {tab === 'files' ? (
              <AgentFiles agentId={'fixture-agent' as Id<'agents'>} />
            ) : (
              <AgentSkills agentId={'fixture-agent' as Id<'agents'>} />
            )}
          </>
        ) : (
          <SkillLibrary />
        )}
      </main>
    </ConvexProvider>
  )
}
