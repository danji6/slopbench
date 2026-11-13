import { ToolkitSelection } from '@/components/chat/toolkits/toolkit-selection'
import { ToolkitSettings } from '@/components/chat/toolkits/toolkit-settings'
import '@/globals.css'
import type { Id } from '@cv/convex/_generated/dataModel'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'
import { useState } from 'react'

import {
  changeManifest,
  completeNextSkillSave,
  failNextToolkitOperation,
  holdSkillSaves,
  observeManifestChanges,
  toolkitEvents,
  toolkitsClient,
} from './toolkits-client'

/** Exercises production components against a reactive configuration fixture. */
export function ToolkitsFixture() {
  const [events, setEvents] = useState('')
  return (
    <ConvexProvider client={toolkitsClient}>
      <ConvexQueryCacheProvider>
        <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
          <ToolkitSettings />
          <ToolkitSelection agentId={'agent' as Id<'agents'>} />
          <button onClick={changeManifest}>Change manifest on disk</button>
          <button onClick={observeManifestChanges}>
            Observe manifest changes
          </button>
          <button onClick={holdSkillSaves}>Hold skill saves</button>
          <button onClick={completeNextSkillSave}>
            Complete next skill save
          </button>
          <button onClick={failNextToolkitOperation}>
            Fail next toolkit operation
          </button>
          <button onClick={() => setEvents(toolkitEvents())}>
            Inspect toolkit events
          </button>
          <output aria-label="Toolkit events">{events}</output>
        </main>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
