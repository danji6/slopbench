import { RippleButton } from '@/components/ui'
import { Popover } from '@/components/ui/popover'
import { useActiveModelInference } from '@/hooks/chat'
import { cn } from '@/lib/utils'
import { SlidersHorizontalIcon } from 'lucide-react'

import { InferenceSettings } from '../models'

export function QuickSettingsWidget({ className }: { className?: string }) {
  const settings = useActiveModelInference()

  if (!settings.editable) return null

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
        className="w-80 max-w-dvw space-y-3 p-4"
      >
        <Popover.Header>
          <Popover.Title>Quick settings</Popover.Title>
        </Popover.Header>

        {settings.model ? (
          <div className="space-y-2">
            <InferenceSettings
              density="compact"
              value={settings.inference}
              onChange={settings.setInference}
            />
          </div>
        ) : (
          <p className="text-muted-foreground py-2 text-sm">
            Select a model from the agent menu to configure inference.
          </p>
        )}
      </Popover.Content>
    </Popover>
  )
}
