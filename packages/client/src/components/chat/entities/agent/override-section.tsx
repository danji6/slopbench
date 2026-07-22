import { SettingsList } from '@/components/ui'
import type { ReactNode } from 'react'
import type { Control } from 'react-hook-form'
import { Controller } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

type OverridableName = 'compactionPrompts' | 'impersonationPrompts'

/**
 * Renders an "Override" toggle for an agent field that inherits the user's
 * value when unset.
 */
export function OverrideSection<K extends OverridableName>({
  control,
  name,
  label,
  description,
  help,
  seed,
  children,
}: {
  control: Control<AgentFormValues>
  name: K
  label: string
  description?: string
  help?: ReactNode
  seed: () => NonNullable<AgentFormValues[K]>
  children: (
    value: NonNullable<AgentFormValues[K]>,
    onChange: (value: AgentFormValues[K]) => void,
  ) => ReactNode
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const overriding = field.value != null
        return (
          <>
            <SettingsList.Switch
              label={<OverrideLabel>{label}</OverrideLabel>}
              description={description}
              checked={overriding}
              onCheckedChange={(on) => field.onChange(on ? seed() : null)}
            />
            {overriding && (
              <SettingsList.Item
                unclickable
                unhoverable
                orientation="vertical"
                help={help}
              >
                {children(
                  field.value as NonNullable<AgentFormValues[K]>,
                  field.onChange,
                )}
              </SettingsList.Item>
            )}
          </>
        )
      }}
    />
  )
}

export function OverrideLabel({ children }: { children?: React.ReactNode }) {
  return (
    <>
      {children}
      <span className="text-muted-foreground text-xs"> (Override)</span>
    </>
  )
}
