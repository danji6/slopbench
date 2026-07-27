/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'
import { createFormControl } from 'react-hook-form'

type Values = { name: string; content: string }

/** A wrapped list line, indented under a `1. ` marker. */
const stored = 'Prompt:\n\n1. do the thing\n   thoroughly'

/**
 * The same content as the editor writes it back. Parsing reformats — see
 * `tests/markdown/round-trip-stability.test.ts` — so this, not `stored`, is
 * what an untouched editor puts into the form.
 */
const baseline = 'Prompt:\n\n1. do the thing\n thoroughly'

function open(defaults: Values) {
  const form = createFormControl<Values>({ defaultValues: defaults })
  let isDirty = false
  form.subscribe({
    formState: { values: true, isDirty: true },
    callback: (state) => (isDirty = !!state.isDirty),
  })
  return { form, dirty: () => isDirty }
}

/** What the content editor's first update does to the form. */
function edit(form: ReturnType<typeof open>['form'], content: string) {
  form.setValue('content', content, { shouldDirty: true })
}

describe('prompt draft baseline', () => {
  test('an editor opening on stored content dirties the form', () => {
    // The defect this guards: every prompt read as edited the moment it was
    // opened, so every visit left a draft behind and the close guard fired on
    // prompts nobody had touched.
    const { form, dirty } = open({ name: 'Reviewer', content: stored })

    edit(form, baseline)

    expect(dirty()).toBe(true)
  })

  test('moving the default to the baseline leaves it clean', () => {
    const { form, dirty } = open({ name: 'Reviewer', content: stored })

    // usePromptDraft's onBaseline, before the first change reaches the form
    form.reset({ ...form.getValues(), content: baseline })
    edit(form, baseline)

    expect(dirty()).toBe(false)
  })

  test('a restored draft is measured against the baseline it carried', () => {
    // "Undo the undoing": the draft is restored, the user takes their edit back
    // out, and the form has to recognise that as the prompt it started from —
    // otherwise the draft it wrote can never be dropped. The baseline travels
    // with the draft because the question can be answered long before the
    // editor that could report it again is on screen.
    const { form, dirty } = open({ name: 'Reviewer', content: stored })
    const draft = {
      values: { name: 'Reviewer', content: `${baseline} twice` },
      baseline,
    }

    form.reset({ name: 'Reviewer', content: draft.baseline })
    form.reset(draft.values, { keepDefaultValues: true })
    expect(dirty()).toBe(true)

    edit(form, baseline)

    expect(dirty()).toBe(false)
  })
})
