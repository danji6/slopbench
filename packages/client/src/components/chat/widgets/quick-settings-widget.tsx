import { RippleButton } from '@/components/ui'
import { Popover } from '@/components/ui/popover'
import { useActiveModelSettings } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { SlidersHorizontalIcon } from 'lucide-react'

import { ModelPicker } from '../models/model-picker'
import { ReasoningPicker } from '../models/reasoning-picker'

export function QuickSettingsWidget({
  className,
  agentPicker,
}: {
  className?: string
  /** Agent picker relocated here when the toolbar is too narrow to fit it. */
  agentPicker?: React.ReactNode
}) {
  const settings = useActiveModelSettings()

  if (!settings.editable && !agentPicker) return null

  return (
    <Popover>
      <Popover.Trigger
        nativeButton
        render={
          <RippleButton
            variant="stealth"
            size="icon"
            className={cn('text-muted-foreground size-10', className)}
            aria-label="Quick settings"
          >
            <SlidersHorizontalIcon />
          </RippleButton>
        }
      />
      <Popover.Content
        align="center"
        side="top"
        className="w-90 max-w-dvw space-y-3 p-4"
      >
        <Popover.Header>
          <Popover.Title>Quick settings</Popover.Title>
        </Popover.Header>

        {agentPicker && (
          <QuickSetting label="Agent">{agentPicker}</QuickSetting>
        )}

        {settings.editable && (
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <QuickSetting label="Model">
              <ModelPicker
                variant="input"
                className="w-full"
                value={settings.model?.id ?? ''}
                onValueChange={settings.setModel}
              />
            </QuickSetting>

            <QuickSetting label="Reasoning">
              <ReasoningPicker
                variant="input"
                className="w-fit justify-between"
                value={settings.reasoningEffort ?? 'auto'}
                onValueChange={settings.setReasoningEffort}
              />
            </QuickSetting>
          </div>
        )}
      </Popover.Content>
    </Popover>
  )
}

function QuickSetting({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground ml-1 text-xs font-medium">
        {label}
      </span>
      {children}
    </div>
  )
}
