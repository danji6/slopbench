import { ModelPicker } from '@/components/chat/models'
import { RippleButton, SettingsList } from '@/components/ui'
import { useView } from '@/hooks/view'
import { Suspense, lazy } from 'react'
import { type Control, Controller } from 'react-hook-form'

import type { SettingsFormValues } from './settings-schema'

const TitlePromptEditor = lazy(() =>
  import('./title-prompt-editor').then((module) => ({
    default: module.TitlePromptEditor,
  })),
)

type TitleGenerationSettingsProps = {
  control: Control<SettingsFormValues>
}

export function TitleGenerationSettings({
  control,
}: TitleGenerationSettingsProps) {
  const view = useView('title-prompt')

  return (
    <SettingsList.Item
      unclickable
      unhoverable
      orientation="vertical"
      label="Title generation"
      description="Choose a model to automatically generate session titles."
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4"
      contentClassName="contents"
    >
      <Controller
        control={control}
        name="titleModel"
        render={({ field }) => (
          <ModelPicker
            id="title-model"
            variant="input"
            allowDeselect
            aria-label="Title model"
            value={field.value ?? ''}
            onValueChange={(value) => field.onChange(value || null)}
          />
        )}
      />
      <Controller
        control={control}
        name="titleSystemPrompt"
        render={({ field }) => (
          <>
            <RippleButton
              variant="input"
              onClick={() => view.open()}
              className="max-w-fit"
            >
              Change prompt
            </RippleButton>
            {view.active && (
              <Suspense fallback={null}>
                <TitlePromptEditor
                  value={field.value}
                  onSave={field.onChange}
                  onClose={view.close}
                />
              </Suspense>
            )}
          </>
        )}
      />
    </SettingsList.Item>
  )
}
