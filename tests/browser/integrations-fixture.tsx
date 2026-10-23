import { IntegrationSelection } from '@/components/chat/integrations/integration-selection'
import { IntegrationSettings } from '@/components/chat/integrations/integration-settings'
import '@/globals.css'
import type { Id } from '@sb/convex/_generated/dataModel'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'
import { useState } from 'react'

import {
  changeManifest,
  completeNextSkillSave,
  failNextIntegrationOperation,
  holdSkillSaves,
  integrationEvents,
  integrationsClient,
  observeManifestChanges,
} from './integrations-client'

/** Exercises production components against a reactive configuration fixture. */
export function IntegrationsFixture() {
  const [events, setEvents] = useState('')
  return (
    <ConvexProvider client={integrationsClient}>
      <ConvexQueryCacheProvider>
        <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
          <IntegrationSettings />
          <IntegrationSelection agentId={'agent' as Id<'agents'>} />
          <button onClick={changeManifest}>Change manifest on disk</button>
          <button onClick={observeManifestChanges}>
            Observe manifest changes
          </button>
          <button onClick={holdSkillSaves}>Hold skill saves</button>
          <button onClick={completeNextSkillSave}>
            Complete next skill save
          </button>
          <button onClick={failNextIntegrationOperation}>
            Fail next integration operation
          </button>
          <button onClick={() => setEvents(integrationEvents())}>
            Inspect integration events
          </button>
          <output aria-label="Integration events">{events}</output>
        </main>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
