import type { SessionMode } from '@/lib/chat/modes'

import type { AgentItem } from '../sessions/agent-combobox'
import { ChatAgentPicker } from '../sessions/chat-agent-picker'
import { ModeWidget } from '../widgets/mode-widget'
import { QuickSettingsWidget } from '../widgets/quick-settings-widget'
import { useComposerLayout } from './composer-layout'

type ComposerToolbarMode = {
  value: SessionMode
  /** Determines whether the mode widget should be shown. */
  workspaceAvailable: boolean
  cycle: () => void | Promise<void> | undefined
}

type ComposerToolbarProps = {
  fallbackAgent?: AgentItem
  mode: ComposerToolbarMode
}

export function ComposerToolbar({ fallbackAgent, mode }: ComposerToolbarProps) {
  const { compact } = useComposerLayout()

  const modeVisible = mode.workspaceAvailable
  const collapse = compact && modeVisible

  return (
    <>
      {!collapse && <ChatAgentPicker fallbackAgent={fallbackAgent} />}
      {modeVisible && <ModeWidget mode={mode.value} onCycle={mode.cycle} />}
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
