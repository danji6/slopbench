import { md } from '@/components/markdown'
import { ThemeColorSetting } from '@/components/theme'
import { CodeEditor, SettingsList } from '@/components/ui'
import { FONT_NAMES, MONO_FONT_NAMES } from '@/fonts'
import type { ResolvedFonts } from '@/hooks/font'
import { DEFAULT_SETTINGS, SOURCE_COLOR } from '@sb/convex/model/defaults'
import { capitalize } from '@sb/core/utils/strings'
import type { Control, UseFormSetValue } from 'react-hook-form'
import { Controller, useWatch } from 'react-hook-form'

import { MessagePreview } from '../../message-preview'
import type { SettingsFormValues } from './settings-schema'

type AppearanceSettingsProps = {
  control: Control<SettingsFormValues>
  setValue: UseFormSetValue<SettingsFormValues>
}

export function AppearanceSettings({
  control,
  setValue,
}: AppearanceSettingsProps) {
  const overrideFonts = useWatch({ control, name: 'override.fonts.enabled' })

  const syncedFonts: ResolvedFonts = {
    uiFont: useWatch({ control, name: 'uiFont' }),
    monoFont: useWatch({ control, name: 'monoFont' }),
    chatFont: useWatch({ control, name: 'chatFont' }),
    chatFontSize: useWatch({ control, name: 'chatFontSize' }),
  }
  const localFonts: ResolvedFonts = {
    uiFont: useWatch({ control, name: 'override.fonts.uiFont' }),
    monoFont: useWatch({ control, name: 'override.fonts.monoFont' }),
    chatFont: useWatch({ control, name: 'override.fonts.chatFont' }),
    chatFontSize: useWatch({ control, name: 'override.fonts.chatFontSize' }),
  }
  const activeFonts = overrideFonts ? localFonts : syncedFonts

  const opts = { shouldDirty: true } as const

  function applyFonts(patch: Partial<ResolvedFonts>) {
    if (patch.uiFont !== undefined) {
      if (overrideFonts) setValue('override.fonts.uiFont', patch.uiFont, opts)
      else setValue('uiFont', patch.uiFont, opts)
    }
    if (patch.monoFont !== undefined) {
      if (overrideFonts)
        setValue('override.fonts.monoFont', patch.monoFont, opts)
      else setValue('monoFont', patch.monoFont, opts)
    }
    if (patch.chatFont !== undefined) {
      if (overrideFonts)
        setValue('override.fonts.chatFont', patch.chatFont, opts)
      else setValue('chatFont', patch.chatFont, opts)
    }
    if (patch.chatFontSize !== undefined) {
      if (overrideFonts)
        setValue('override.fonts.chatFontSize', patch.chatFontSize, opts)
      else setValue('chatFontSize', patch.chatFontSize, opts)
    }
  }

  function toggleOverride(enabled: boolean) {
    setValue('override.fonts.enabled', enabled, opts)
    if (enabled) {
      setValue('override.fonts.uiFont', syncedFonts.uiFont, opts)
      setValue('override.fonts.monoFont', syncedFonts.monoFont, opts)
      setValue('override.fonts.chatFont', syncedFonts.chatFont, opts)
      setValue('override.fonts.chatFontSize', syncedFonts.chatFontSize, opts)
    }
  }

  return (
    <SettingsList className="pb-4">
      <SettingsList.Switch
        label="Override device font settings"
        description="Save font choices to this device only, instead of syncing them to your account."
        checked={overrideFonts}
        onCheckedChange={toggleOverride}
      />
      <FontFields values={activeFonts} onChange={applyFonts} />
      <Controller
        control={control}
        name="groupBySender"
        render={({ field }) => (
          <SettingsList.Switch
            label="Group consecutive messages by sender"
            description="Skip repeated headers when the same sender posts several messages in a row."
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="chatWidth"
        render={({ field }) => (
          <SettingsList.Slider
            label="Chat width"
            value={field.value}
            defaultValue={DEFAULT_SETTINGS.chatWidth}
            minValue={600}
            maxValue={1400}
            step={20}
            onChange={field.onChange}
          />
        )}
      />
      <SettingsList.Item
        label="Preview"
        orientation="vertical"
        unclickable
        unhoverable
      >
        <FontPreview fonts={activeFonts} control={control} />
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
            description="CSS rules to apply to messages."
            help={md`
              CSS rules to apply to messages.

              You can use [Material 3 roles](https://m3.material.io/styles/color/roles) as variables.
              They follow the same naming conventions, but in kebab-case. For example:

              - Primary: \`var(--primary)\`
              - On Secondary: \`var(--on-secondary)\`

              Additional selectors:

              - AI messages: \`.ai\`
              - User messages: \`.usr\`
              - System messages: \`.sys\`
              - Quoted text: \`.quoted\`
              - File mentions: \`.mention\`
            `}
          >
            <CodeEditor
              value={field.value}
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
        name="themeMode"
        render={({ field }) => (
          <SettingsList.Select
            label="Theme mode"
            description="Change the theme mode."
            value={field.value}
            onValueChange={(v) =>
              field.onChange(
                (v as typeof field.value) || DEFAULT_SETTINGS.themeMode,
              )
            }
          >
            <SettingsList.Select.Item value="system">
              System
            </SettingsList.Select.Item>
            <SettingsList.Select.Item value="light">
              Light
            </SettingsList.Select.Item>
            <SettingsList.Select.Item value="dark">
              Dark
            </SettingsList.Select.Item>
          </SettingsList.Select>
        )}
      />
      <Controller
        control={control}
        name="themeColor"
        render={({ field }) => (
          <SettingsList.Item
            label="Theme color"
            description="Change the theme color."
            unclickable
            unhoverable
          >
            <ThemeColorSetting
              value={field.value}
              onChange={field.onChange}
              onClear={() => field.onChange(SOURCE_COLOR)}
            />
          </SettingsList.Item>
        )}
      />
    </SettingsList>
  )
}

type FontFieldsProps = {
  values: ResolvedFonts
  onChange: (patch: Partial<ResolvedFonts>) => void
}

function FontFields({ values, onChange }: FontFieldsProps) {
  const fontItems = renderFontItems(FONT_NAMES)
  const monoFontItems = renderFontItems(MONO_FONT_NAMES)

  return (
    <>
      <SettingsList.Combobox
        label="UI font"
        description="Change the font used to render the UI."
        value={values.uiFont}
        onValueChange={(v) => onChange({ uiFont: v || 'system' })}
        noDeselect
        allowCustom
        placeholder="Select font..."
        renderValue={(val) => capitalize(val || 'system')}
      >
        {fontItems}
      </SettingsList.Combobox>
      <SettingsList.Combobox
        label="Mono font"
        description="Font used for code blocks and other monospaced text."
        value={values.monoFont}
        onValueChange={(v) => onChange({ monoFont: v || 'system' })}
        noDeselect
        allowCustom
        placeholder="Select font..."
        renderValue={(val) => capitalize(val || 'system')}
      >
        {monoFontItems}
      </SettingsList.Combobox>
      <SettingsList.Combobox
        label="Chat font"
        help={md`
          This will affect messages, reasoning blocks,
          summary blocks, and other text parts in the chat messages.

          Tip: You can type in a custom font name that matches
          one installed on your system.
        `}
        description="Change the font used to render messages."
        value={values.chatFont}
        onValueChange={(v) => onChange({ chatFont: v || 'system' })}
        noDeselect
        allowCustom
        placeholder="Select font..."
        renderValue={(val) => capitalize(val || 'system')}
      >
        {fontItems}
      </SettingsList.Combobox>
      <SettingsList.Slider
        label="Chat font size"
        value={values.chatFontSize}
        defaultValue={DEFAULT_SETTINGS.chatFontSize}
        minValue={8}
        maxValue={48}
        step={1}
        onChange={(v: number) => onChange({ chatFontSize: v })}
      />
    </>
  )
}

function FontPreview({
  fonts,
  control,
}: {
  fonts: ResolvedFonts
  control: Control<SettingsFormValues>
}) {
  const customCss = useWatch({ control, name: 'customCss' })
  return (
    <MessagePreview
      customCss={customCss}
      chatFont={fonts.chatFont}
      monoFont={fonts.monoFont}
      chatFontSize={fonts.chatFontSize}
    />
  )
}

function renderFontItems(names: string[]) {
  return (
    <>
      <SettingsList.Combobox.Item value="system">
        System
      </SettingsList.Combobox.Item>
      {names.map((name) => (
        <SettingsList.Combobox.Item key={name} value={name}>
          {name}
        </SettingsList.Combobox.Item>
      ))}
    </>
  )
}
