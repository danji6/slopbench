import type { SessionMode } from '@/lib/chat/modes'
import type { ApprovalMode } from '@sb/convex/types'

import type { AgentItem } from '../sessions/agent-combobox'
import { ChatAgentPicker } from '../sessions/chat-agent-picker'
import { ApprovalModeWidget, ModeWidget } from '../widgets/mode-widget'
import { QuickSettingsWidget } from '../widgets/quick-settings-widget'
import { useComposerLayout } from './composer-layout'

export type ComposerToolbarMode = {
  value: SessionMode
  workspaceAvailable: boolean
  set: (mode: SessionMode) => void | Promise<void>
}

type ComposerToolbarApproval = {
  value: ApprovalMode
  available: boolean
  toggle: () => void | Promise<void>
}

type ComposerToolbarProps = {
  fallbackAgent?: AgentItem
  mode: ComposerToolbarMode
  approval: ComposerToolbarApproval
}

export function ComposerToolbar({
  fallbackAgent,
  mode,
  approval,
}: ComposerToolbarProps) {
  const { compact } = useComposerLayout()

  const modeVisible = mode.workspaceAvailable
  const collapse = compact && modeVisible

  return (
    <>
      {!collapse && <ChatAgentPicker fallbackAgent={fallbackAgent} />}
      {modeVisible && (
        <ModeWidget mode={mode.value} onDisable={() => mode.set('normal')} />
      )}
      {approval.available && (
        <ApprovalModeWidget mode={approval.value} onToggle={approval.toggle} />
      )}
      <QuickSettingsWidget
        agentPicker={
          collapse ? (
            <ChatAgentPicker fallbackAgent={fallbackAgent} className="w-full" />
          ) : undefined
        }
      />
    </>
  )
}
