import { Sidebar } from '@/components/ui'
import { useTools } from '@/hooks/chat'

import { SessionLockSection } from './session-disable-section'
import { SessionRequestLogSection } from './session-request-log'
import { SessionSettingsSection } from './session-settings-section'
import { SessionSharingSection } from './session-sharing-section'
import { SessionWorkspaceSection } from './session-workspace-section'

export function SessionConfig() {
  const { tools } = useTools()
  const canUseWorkspace = tools.some(
    (tool) => 'requiresWorkspace' in tool && tool.requiresWorkspace,
  )

  return (
    <>
      {canUseWorkspace && (
        <Sidebar.Section label="Workspace">
          <SessionWorkspaceSection />
        </Sidebar.Section>
      )}
      <Sidebar.Section label="Sharing">
        <SessionSharingSection />
        <SessionLockSection />
      </Sidebar.Section>
      <Sidebar.Section label="Settings">
        <SessionSettingsSection />
      </Sidebar.Section>
      <Sidebar.Section label="Debug">
        <SessionRequestLogSection />
      </Sidebar.Section>
    </>
  )
}
