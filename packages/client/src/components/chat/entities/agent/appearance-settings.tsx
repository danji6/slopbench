import { MessagePreview } from '@/components/chat/message-preview'
import { md } from '@/components/markdown'
import { ThemeColorSetting } from '@/components/theme'
import { CodeEditor, SettingsList } from '@/components/ui'
import { useSettings } from '@/hooks/chat'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { Control } from 'react-hook-form'
import { Controller, useWatch } from 'react-hook-form'

import { CODE_BLOCK_SETTINGS, CodeBlockSetting } from '../code-block-setting'
import type { AgentFormValues } from './agent-form'
import { OverrideLabel } from './override-section'

export function AppearanceSettings({
  control,
}: {
  control: Control<AgentFormValues>
}) {
  const customCss = useWatch({ control, name: 'customCss' })

  const codeBlockHighlighting = useWatch({
    control,
    name: 'codeBlockHighlighting',
  })

  const codeBlockLineNumbers = useWatch({
    control,
    name: 'codeBlockLineNumbers',
  })

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
        <MessagePreview
          baseCss={settings?.customCss}
          customCss={customCss}
          codeBlockHighlighting={
            codeBlockHighlighting ?? settings?.codeBlockHighlighting
          }
          codeBlockLineNumbers={
            codeBlockLineNumbers ?? settings?.codeBlockLineNumbers
          }
        />
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
              These override the global CSS rules, on every message of the
              conversation:

              - AI messages: \`.ai\`
              - User messages: \`.user\`
              - System messages: \`.sys\`

              Note that to allow every identity to have their own styling, the
              CSS is snapshotted on each message this agent sends.
            `}
          >
            <CodeEditor
              value={field.value ?? ''}
              onChange={field.onChange}
              fullscreenId="agent-css"
              language="css"
              placeholder="p { font-style: italic; }"
              className="max-h-60 min-h-36"
              editorClassName="text-sm"
            />
          </SettingsList.Item>
        )}
      />
      {CODE_BLOCK_SETTINGS.map(({ name, label }) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <CodeBlockSetting
              label={label}
              value={field.value}
              inheritedValue={settings?.[name] ?? DEFAULT_SETTINGS[name]}
              onChange={field.onChange}
            />
          )}
        />
      ))}
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
