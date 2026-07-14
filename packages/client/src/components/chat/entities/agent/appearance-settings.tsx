import { MessagePreview } from '@/components/chat/message-preview'
import { md } from '@/components/markdown'
import { ThemeColorSetting } from '@/components/theme'
import { CodeEditor, SettingsList } from '@/components/ui'
import { useSettings } from '@/hooks/chat'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { Control } from 'react-hook-form'
import { Controller, useWatch } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'
import { OverrideLabel } from './override-section'

export function AppearanceSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const customCss = useWatch({ control, name: 'customCss' })
  const settings = useSettings()
  const inheritedWidth = settings?.chatWidth ?? DEFAULT_SETTINGS.chatWidth

  return (
    <SettingsList>
      <Controller
        control={control}
        name="chatWidth"
        render={({ field }) => (
          <SettingsList.Slider
            label={<OverrideLabel>Chat width</OverrideLabel>}
            optional
            value={field.value ?? undefined}
            defaultValue={inheritedWidth}
            minValue={600}
            maxValue={1400}
            step={20}
            onChange={(v: number | undefined) => field.onChange(v ?? null)}
          />
        )}
      />
      <SettingsList.Item
        label="Preview"
        orientation="vertical"
        unclickable
        unhoverable
      >
        <MessagePreview customCss={customCss} />
      </SettingsList.Item>
      <Controller
        control={control}
        name="customCss"
        render={({ field }) => (
          <SettingsList.Item
            unclickable
            unhoverable
            orientation="vertical"
            label="Custom CSS"
            help={md`
              These override the global CSS rules.

              Note that to allow every
              identity to have their own styling, the CSS is snapshotted for each
              individual message.
            `}
          >
            <CodeEditor
              value={field.value ?? ''}
              onChange={field.onChange}
              language="css"
              placeholder="p { font-style: italic; }"
              className="max-h-60 min-h-36"
              editorClassName="text-sm"
            />
          </SettingsList.Item>
        )}
      />
      <Controller
        control={control}
        name="themeColor"
        render={({ field }) => (
          <SettingsList.Item
            unclickable
            unhoverable
            label={<OverrideLabel>Theme color</OverrideLabel>}
          >
            <ThemeColorSetting
              value={field.value ?? ''}
              onChange={field.onChange}
              onClear={() => field.onChange('')}
            />
          </SettingsList.Item>
        )}
      />
    </SettingsList>
  )
}
