import { NotificationProvider } from '@/components/chat/notifications/notification-provider'
import { FolderPicker } from '@/components/chat/sessions/folder-picker'
import { SessionListView } from '@/components/chat/sessions/session-list'
import '@/globals.css'
import { SessionStoreProvider, useSessionGroups } from '@/hooks/chat/sessions'
import {
  applyTheme,
  exportSchemeCss,
  suppressNextThemeAnimation,
} from '@/lib/theme'
import { api } from '@sb/convex/_generated/api'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider, useQuery } from 'convex/react'
import { useState } from 'react'

import {
  resolveSessionQueries,
  sessionFoldersFixtureClient,
  slowSessions,
} from './session-folders-client'

function setTheme(dark: boolean) {
  const sourceColor = '#6750a4'
  const { css } = exportSchemeCss(sourceColor, dark, 0)
  suppressNextThemeAnimation()
  applyTheme({ sourceColor, mode: dark ? 'dark' : 'light', contrast: 0, css })
}

setTheme(false)

function Controls() {
  const [selected, setSelected] = useState<string | null>('n')
  const [parent, setParent] = useState<string | null>(null)
  const [disabled, setDisabled] = useState(false)
  const folders = useQuery(api.sessionFolders.list)
  const { pages } = useSessionGroups()
  return (
    <section className="flex flex-col gap-3 p-3">
      <FolderPicker
        value={selected}
        onChange={setSelected}
        disabled={disabled}
      />
      <FolderPicker
        value={parent}
        onChange={setParent}
        rootLabel="Top level"
        label="Parent folder"
      />
      <label>
        <input
          type="checkbox"
          checked={disabled}
          onChange={(event) => setDisabled(event.target.checked)}
        />
        Disable picker
      </label>
      <button
        onClick={() =>
          setTheme(!document.documentElement.classList.contains('dark'))
        }
      >
        Toggle theme
      </button>
      {slowSessions && (
        <button onClick={resolveSessionQueries}>Resolve session queries</button>
      )}
      <output data-testid="selected-folder">{selected ?? 'none'}</output>
      <output data-testid="loaded-pages" className="sr-only">
        {JSON.stringify(
          Object.fromEntries(
            Object.entries(pages).map(([key, page]) => [
              key,
              page.results.length,
            ]),
          ),
        )}
      </output>
      <output data-testid="folder-state" className="sr-only">
        {JSON.stringify(folders)}
      </output>
    </section>
  )
}

/** Exercises production sidebar, folder controls, and picker against a local fixture. */
export function SessionFoldersFixture() {
  return (
    <ConvexProvider client={sessionFoldersFixtureClient}>
      <ConvexQueryCacheProvider>
        <SessionStoreProvider>
          <NotificationProvider>
            <main className="bg-background text-foreground w-72 max-w-full py-3">
              <div className="h-[600px]" data-testid="sidebar">
                <SessionListView />
              </div>
              <Controls />
            </main>
          </NotificationProvider>
        </SessionStoreProvider>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
