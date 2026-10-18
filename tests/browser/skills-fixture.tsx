import { AgentFiles } from '@/components/chat/skills/agent-files'
import { AgentSkills } from '@/components/chat/skills/agent-skills'
import { SkillLibrary } from '@/components/chat/skills/skill-library'
import { SettingsTabs } from '@/components/ui/settings-tabs'
import '@/globals.css'
import type { Id } from '@sb/convex/_generated/dataModel'
import { ConvexProvider } from 'convex/react'
import { useState } from 'react'

import {
  failNextSkillCheck,
  failNextSkillOperation,
  latestSkillOperation,
  removeFixtureHome,
  restoreFixtureSkillData,
  setFixtureHome,
  shareFixtureHome,
  skillsFixtureClient,
  toggleBusySkillAgent,
} from './skills-client'

/** Production settings components with an isolated reactive backend fixture. */
export function SkillsFixture() {
  const [view, setView] = useState('agent')
  const [agentId, setAgentId] = useState('fixture-agent' as Id<'agents'>)
  const [tab, setTab] = useState('skills')
  const [operation, setOperation] = useState('')
  return (
    <ConvexProvider client={skillsFixtureClient}>
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">
          Personal agent files — browser fixture
        </h1>
        <nav className="flex gap-4 py-4">
          <button
            onClick={() => {
              setAgentId('fixture-agent' as Id<'agents'>)
              setView('agent')
            }}
          >
            Agent settings
          </button>
          <button
            onClick={() => {
              setAgentId('other-agent' as Id<'agents'>)
              setView('agent')
            }}
          >
            Other agent settings
          </button>
          <button onClick={() => setView('library')}>Skill library</button>
          <button
            onClick={() => setOperation(JSON.stringify(latestSkillOperation()))}
          >
            Inspect last operation
          </button>
        </nav>
        <button onClick={failNextSkillOperation}>Fail next operation</button>
        <button onClick={failNextSkillCheck}>Fail next skill check</button>
        <button onClick={restoreFixtureSkillData}>Restore skill data</button>
        <button onClick={() => setFixtureHome(true)}>
          Assign managed fixture folder
        </button>
        <button onClick={() => setFixtureHome(false)}>
          Assign custom fixture folder
        </button>
        <button onClick={removeFixtureHome}>
          Remove fixture folder on disk
        </button>
        <button onClick={toggleBusySkillAgent}>Toggle busy agent</button>
        <button onClick={shareFixtureHome}>Share fixture folder</button>
        <output aria-label="Last operation">{operation}</output>
        {view === 'agent' ? (
          <>
            <button onClick={() => setTab('skills')}>Skills</button>
            <button onClick={() => setTab('files')}>Files</button>
            {tab === 'files' ? (
              <AgentFiles agentId={agentId} />
            ) : (
              <SettingsTabs
                value="skills"
                className="h-[min(60svh,500px)] min-h-0"
              >
                <SettingsTabs.Content
                  value="skills"
                  title="Skills"
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                >
                  <AgentSkills agentId={agentId} />
                </SettingsTabs.Content>
              </SettingsTabs>
            )}
          </>
        ) : (
          <SkillLibrary />
        )}
      </main>
    </ConvexProvider>
  )
}
