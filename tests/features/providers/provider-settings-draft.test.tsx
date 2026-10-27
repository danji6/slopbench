import type {
  ProviderFormValues,
  SettingsFormValues,
} from '@/components/chat/entities/user/settings-schema'
import { type FormDraft, useFormDraft } from '@/hooks/chat/form-draft'
import { useProviderSettingsSync } from '@/hooks/chat/provider-settings'
import { draftRestore } from '@/lib/chat/draft-restore'
import { clearEditorDraft, getEditorDraft } from '@/lib/chat/editor-draft-store'
import { providerForm } from '@/lib/provider-settings'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ModelProviderView } from '@sb/convex/model/providers'
import { modelMetadata } from '@sb/core/discovered-model'
import type { DiscoveredModel } from '@sb/core/model-discovery'
import { afterEach, beforeAll, expect, test } from 'bun:test'
import { convexToJson, jsonToConvex } from 'convex/values'
import { act, useEffect, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { type UseFormReturn, useForm } from 'react-hook-form'
import { setupDom } from '~/tests/setup/dom'

setupDom()

const KEY = 'provider-settings-draft-test'
const CONNECTION: ModelProviderView = {
  _id: 'provider' as Id<'modelProviders'>,
  connectionId: 'provider' as Id<'modelProviders'>,
  ownerId: 'owner' as Id<'users'>,
  id: 'openai',
  auth: 'apiKey',
  configRevision: 1,
  hasKey: false,
  enabled: true,
  models: [],
}

type SettingsEditor = {
  form: UseFormReturn<SettingsFormValues>
  draft: FormDraft<SettingsFormValues>
  syncConnections: (connections: ModelProviderView[]) => void
  isDirty: boolean
}

type ProviderSyncProps = {
  form: UseFormReturn<SettingsFormValues>
  connections: ModelProviderView[]
}

let editor: SettingsEditor
let root: Root | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  clearEditorDraft(KEY)
  const pending = draftRestore.peek()
  if (pending?.key === KEY) draftRestore.dismiss(pending)
})

function ProviderSync({ form, connections }: ProviderSyncProps) {
  useProviderSettingsSync(form, connections)
  return null
}

function Harness() {
  const [connections, syncConnections] = useState([CONNECTION])
  const form = useForm<SettingsFormValues>({
    defaultValues: {
      displayName: 'User',
      providers: [providerForm(CONNECTION)],
    },
  })
  const draft = useFormDraft(KEY, form, 'your settings')
  const isDirty = form.formState.isDirty

  useEffect(() => {
    editor = { form, draft, syncConnections, isDirty }
  }, [form, draft, syncConnections, isDirty])

  return <ProviderSync form={form} connections={connections} />
}

async function mount() {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Harness />))
}

function selectModel(model: DiscoveredModel) {
  act(() => {
    const provider = editor.form.getValues('providers')[0]
    editor.form.setValue(
      'providers',
      [
        {
          ...provider,
          models: [
            {
              id: model.id,
              source: 'discovered',
              available: true,
              discovered: modelMetadata(model),
              _clientId: 'selected-model',
            },
          ],
        },
      ],
      { shouldDirty: true },
    )
  })
}

async function saveAndSync() {
  const values = editor.form.getValues()
  const provider: ProviderFormValues = {
    ...values.providers[0],
    configRevision: 2,
    apiKey: undefined,
    previewId: undefined,
  }
  const saved = { ...CONNECTION, configRevision: 2, models: provider.models }
  const remote = jsonToConvex(convexToJson(saved)) as ModelProviderView

  // The mutation's reactive query update and local reset share a React commit.
  await act(async () => {
    editor.syncConnections([remote])
    editor.form.reset({
      ...values,
      providers: [provider],
      removedProviders: [],
    })
    editor.draft.clear()
  })
}

const MODELS: DiscoveredModel[] = [
  { id: 'minimal' },
  { id: 'label-only', label: 'Model' },
  { id: 'context-only', contextWindow: 128_000 },
  {
    id: 'complete',
    label: 'Model',
    contextWindow: 128_000,
    reasoning: { type: 'effort', efforts: ['low', 'high'] },
  },
]

test.each(MODELS)(
  'saving a discovered model leaves no draft to restore: $id',
  async (model) => {
    await mount()
    selectModel(model)
    expect(editor.isDirty).toBe(true)

    await saveAndSync()
    // Allow a wrongly scheduled draft autosave to run before reopening.
    await act(async () => {
      await Bun.sleep(350)
    })

    expect(editor.isDirty).toBe(false)
    expect(getEditorDraft(KEY)).toBeUndefined()
    act(() => editor.draft.sync(editor.form.getValues()))
    expect(draftRestore.peek()).toBeUndefined()
  },
)

test('preserves a real unsaved edit when provider metadata synchronizes', async () => {
  await mount()
  act(() => {
    editor.form.setValue('displayName', 'Edited', { shouldDirty: true })
    editor.syncConnections([{ ...CONNECTION, hasKey: true }])
  })
  await act(async () => {
    await Bun.sleep(350)
  })

  expect(editor.isDirty).toBe(true)
  expect(editor.form.getValues('displayName')).toBe('Edited')
  expect(getEditorDraft<SettingsFormValues>(KEY)?.displayName).toBe('Edited')
  act(() =>
    editor.draft.sync({
      displayName: 'User',
      providers: [providerForm(CONNECTION)],
    }),
  )
  expect(draftRestore.peek()?.key).toBe(KEY)
})
