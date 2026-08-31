/// <reference types="bun-types" />
import { describe, expect, mock, test } from 'bun:test'
import { type ComponentProps, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/components/ui', () => ({
  RippleButton: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => (
    <button {...props} />
  ),
  Textarea: ({
    variant: _variant,
    ...props
  }: ComponentProps<'textarea'> & { variant?: string }) => (
    <textarea {...props} />
  ),
}))

const { AnswerPickerBody, AnswerPickerFooter, AnswerPickerHeader } =
  await import('@/components/chat/workspace/answer-picker-content')

const noop = () => undefined

describe('answer picker content', () => {
  test('keeps Tab targets to the choice list and one-row text input', () => {
    const html = renderToStaticMarkup(
      <>
        <AnswerPickerHeader
          questionIndex={0}
          questionCount={1}
          onNavigate={noop}
          onAbort={noop}
        />
        <AnswerPickerBody
          question={{
            question: 'Pick several',
            options: [{ label: 'A' }, { label: 'B' }],
            multiple: true,
          }}
          answer={{
            selectedOptionIndices: [0, 1],
            customAnswer: '',
            note: '',
            skipped: false,
          }}
          choicesRef={createRef()}
          textRef={createRef()}
          onSelectOption={noop}
          onTextChange={noop}
        />
        <AnswerPickerFooter
          completeCount={1}
          questionCount={1}
          currentComplete
          skipped={false}
          lastQuestion
          allComplete
          submitting={false}
          onToggleSkip={noop}
          onAdvance={noop}
        />
      </>,
    )

    expect(html).toContain('rows="1"')
    expect(html).toContain('min-h-10')
    expect(html).toContain('role="group"')
    expect(html.match(/role="checkbox"/g)).toHaveLength(2)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(8)
    expect(html).not.toContain('tabindex="0"')
  })
})
