/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'
import { createFormControl } from 'react-hook-form'

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
