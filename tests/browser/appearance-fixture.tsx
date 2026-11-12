import { AppearanceSettings } from '@/components/chat/entities/user/appearance-settings'
import type { SettingsFormValues } from '@/components/chat/entities/user/settings-schema'
import { defaultSettingsValues } from '@/components/chat/entities/user/user-settings-values'
import '@/globals.css'
import { useScopedTheme, useTheme } from '@/hooks/theme'
import type { ThemeMode } from '@/lib/theme'
import { ThemeScope } from '@/providers/theme-scope'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

export function AppearanceFixture() {
  const [mode, setMode] = useState<ThemeMode>('system')
  const { control, handleSubmit, setValue } = useForm<SettingsFormValues>({
    defaultValues: defaultSettingsValues(),
  })
  const previewMode = useWatch({ control, name: 'themeMode' })
  const previewColor = useWatch({ control, name: 'themeColor' })
  const scope = useScopedTheme(previewColor, previewMode)
  useTheme(null, 'you', mode)

  return (
    <ThemeScope className={scope}>
      <form
        aria-label="Appearance preview"
        className={scope}
        onSubmit={handleSubmit((values) => setMode(values.themeMode))}
      >
        <AppearanceSettings control={control} setValue={setValue} />
        <button type="submit">Apply theme</button>
      </form>
    </ThemeScope>
  )
}
