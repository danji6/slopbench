import { AnimatedToolbar } from '@/components/ui/animated-toolbar'
import type { SessionMode } from '@/lib/chat/modes'
import { Result } from '@/lib/result'
import type { ApprovalMode } from '@sb/convex/types'
import { LightbulbIcon, PaperclipIcon, PlusIcon } from 'lucide-react'

import { DropdownMenu, RippleButton } from '../../ui'
import type { AgentItem } from '../sessions/agent-combobox'
import { ChatAgentPicker } from '../sessions/chat-agent-picker'
import { ApprovalModeWidget, ModeWidget } from '../widgets/mode-widget'

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
  const modeVisible = mode.workspaceAvailable && mode.value === 'plan'

  return (
    <AnimatedToolbar className="min-w-0">
      <ChatAgentPicker fallbackAgent={fallbackAgent} />
      <AnimatedToolbar.Item visible={modeVisible}>
        <div className="pl-1">
          <ModeWidget onDisable={() => mode.set('normal')} />
        </div>
      </AnimatedToolbar.Item>
      <AnimatedToolbar.Item visible={approval.available}>
        <div className="pl-1">
          <ApprovalModeWidget
            mode={approval.value}
            onToggle={approval.toggle}
          />
        </div>
      </AnimatedToolbar.Item>
    </AnimatedToolbar>
  )
}

export function ComposerActions({
  mode,
  onAddFiles,
}: {
  mode?: ComposerToolbarMode
  onAddFiles: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <RippleButton
            size="icon"
            variant="surface"
            aria-label="Composer actions"
          >
            <PlusIcon />
          </RippleButton>
        }
      />
      <DropdownMenu.Content side="top" align="start" className="min-w-48">
        <DropdownMenu.Item onClick={onAddFiles}>
          <PaperclipIcon />
          Add files
        </DropdownMenu.Item>
        {mode?.workspaceAvailable && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Switch
              checked={mode.value === 'plan'}
              onCheckedChange={(checked) =>
                void Result.from(() =>
                  mode.set(checked ? 'plan' : 'normal'),
                ).catch()
              }
            >
              <span className="flex items-center gap-2">
                <LightbulbIcon className="size-4" />
                Plan mode
              </span>
            </DropdownMenu.Switch>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
