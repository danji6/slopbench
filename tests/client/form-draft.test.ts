/// <reference types="bun-types" />
import {
  draftRestore,
  isDraftPending,
  requestDraftRestore,
} from '@/lib/chat/draft-restore'
import {
  agentSettingsDraftKey,
  clearEditorDraft,
  getEditorDraft,
  setEditorDraft,
} from '@/lib/chat/editor-draft-store'
import { afterEach, describe, expect, test } from 'bun:test'
import { createFormControl } from 'react-hook-form'

import { setupDom } from '../setup/dom'

setupDom()

type Prompt = { id: string; name: string }
type Values = { name: string; prompts: Prompt[] }

function makeForm() {
  return createFormControl<Values>({
    defaultValues: { name: 'Agent', prompts: [] },
  })
}

/**
 * `useFormDraft` autosaves through `form.subscribe`, and these pin the two
 * properties of that API it depends on. `form.watch` was used first and lost
 * data: its callback can only read `form.formState`, which is a snapshot of the
 * last committed render, so the change being reported is not yet reflected in
 * it.
 */
describe('form draft autosave contract', () => {
  test('reports the first change to a clean form as dirty', () => {
    // The regression: adding a prompt is a single change to an otherwise clean
    // settings form, and nothing else touches that form until the prompt editor
    // saves. Missing this one event meant the draft was never written at all,
    // so a reload lost the prompt, its text and the reopened editor together.
    const form = makeForm()
    const seen: (boolean | undefined)[] = []

    const unsubscribe = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ isDirty }) => seen.push(isDirty),
    })
    form.setValue('prompts', [{ id: 'p1', name: 'New Prompt' }], {
      shouldDirty: true,
    })
    unsubscribe()

    // A change may emit more than once; the debounce collapses that. What must
    // hold is that the form never reports itself clean while it is not.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((dirty) => dirty === true)).toBe(true)
  })

  test('hands the callback the values that go into the draft', () => {
    const form = makeForm()
    let saved: Values | undefined

    const unsubscribe = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ values, isDirty }) => {
        if (isDirty) saved = values
      },
    })
    form.setValue('prompts', [{ id: 'p1', name: 'Added' }], {
      shouldDirty: true,
    })
    unsubscribe()

    expect(saved?.prompts).toEqual([{ id: 'p1', name: 'Added' }])
    expect(saved?.name).toBe('Agent')
  })

  test('stays clean when a reset restores the stored values', () => {
    // `restore()` is preceded by a reset to the backend values; that reset must
    // not be mistaken for user input and overwrite the draft.
    const form = makeForm()
    form.setValue('name', 'Edited', { shouldDirty: true })

    const seen: (boolean | undefined)[] = []
    const unsubscribe = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ isDirty }) => seen.push(isDirty),
    })
    form.reset({ name: 'Agent', prompts: [] })
    unsubscribe()

    expect(seen.every((dirty) => !dirty)).toBe(true)
  })

  test('reports clean once a change is reverted by hand', () => {
    // What the draft hangs on: reverting is not an event of its own, it is the
    // form going quiet again.
    const form = makeForm()
    const seen: (boolean | undefined)[] = []

    const unsubscribe = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ isDirty }) => seen.push(isDirty),
    })
    form.setValue('name', 'Edited', { shouldDirty: true })
    form.setValue('name', 'Agent', { shouldDirty: true })
    unsubscribe()

    expect(seen.at(-1)).toBe(false)
  })

  test('a restored draft is dirty against the stored values', () => {
    // `keepDefaultValues` is what makes Save/Apply enable and Discard revert to
    // what the backend actually holds.
    const form = makeForm()
    form.reset({ name: 'Agent', prompts: [] })

    let isDirty: boolean | undefined
    const unsubscribe = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: (data) => (isDirty = data.isDirty),
    })
    form.reset(
      { name: 'Agent', prompts: [{ id: 'p1', name: 'Recovered' }] },
      { keepDefaultValues: true },
    )
    unsubscribe()

    expect(isDirty).toBe(true)
  })
})

const KEY = agentSettingsDraftKey('a1')

afterEach(() => {
  clearEditorDraft(KEY)
  let pending = draftRestore.peek()
  while (pending) {
    draftRestore.dismiss(pending)
    pending = draftRestore.peek()
  }
})

/**
 * `useFormDraft` without React: its subscription and its `sync`, over the real
 * draft store and restore queue. The debounce is the hook's own and is left
 * out, so a save is observable in the same tick.
 */
function mountDraft(form: ReturnType<typeof makeForm>) {
  const unsubscribe = form.subscribe({
    formState: { values: true, isDirty: true },
    callback: ({ values, isDirty }) => {
      if (isDirty) setEditorDraft(KEY, values)
      else if (!isDraftPending(KEY)) clearEditorDraft(KEY)
    },
  })

  return {
    unsubscribe,
    sync: (values: Values) => {
      const saved = getEditorDraft<Values>(KEY)
      if (saved !== undefined)
        requestDraftRestore({
          key: KEY,
          label: 'these agent settings',
          apply: () => form.reset(saved, { keepDefaultValues: true }),
          discard: () => clearEditorDraft(KEY),
        })
      form.reset(values)
    },
  }
}

const STORED: Values = { name: 'Agent', prompts: [] }

describe('form draft lifecycle', () => {
  test('drops the draft when the form returns to the stored values', () => {
    // The regression: reverting a setting by hand left the pre-revert draft
    // behind, so reopening the editor offered to restore a change the user had
    // already taken back — while Save/Apply sat greyed out.
    const form = makeForm()
    const draft = mountDraft(form)
    draft.sync(STORED)

    form.setValue('name', 'Edited', { shouldDirty: true })
    expect(getEditorDraft<Values>(KEY)).toEqual({ ...STORED, name: 'Edited' })

    form.setValue('name', 'Agent', { shouldDirty: true })
    draft.unsubscribe()

    expect(getEditorDraft(KEY)).toBeUndefined()
  })

  test('keeps the draft through the reset that opening performs', () => {
    // `sync` queues the question first: the subscription runs inside
    // `form.reset`, where the form is clean and the draft would otherwise read
    // as a revert and be cleared before anyone could be asked about it.
    setEditorDraft(KEY, { ...STORED, name: 'Edited' })
    const form = makeForm()
    const draft = mountDraft(form)

    draft.sync(STORED)
    draft.unsubscribe()

    expect(getEditorDraft<Values>(KEY)).toEqual({ ...STORED, name: 'Edited' })
    expect(draftRestore.peek()?.key).toBe(KEY)
  })

  test('restores onto the stored values, leaving them as the baseline', () => {
    setEditorDraft(KEY, { ...STORED, name: 'Edited' })
    const form = makeForm()
    const draft = mountDraft(form)
    draft.sync(STORED)

    let isDirty: boolean | undefined
    const unsubscribe = form.subscribe({
      formState: { values: true, isDirty: true },
      callback: (data) => (isDirty = data.isDirty),
    })
    draftRestore.restore(draftRestore.peek()!)
    unsubscribe()
    draft.unsubscribe()

    expect(form.getValues().name).toBe('Edited')
    expect(isDirty).toBe(true)
  })

  test('discarding the offer drops the draft for good', () => {
    setEditorDraft(KEY, { ...STORED, name: 'Edited' })
    const form = makeForm()
    const draft = mountDraft(form)
    draft.sync(STORED)

    draftRestore.discard(draftRestore.peek()!)
    draft.unsubscribe()

    expect(getEditorDraft(KEY)).toBeUndefined()
  })
})
