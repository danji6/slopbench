/// <reference types="bun-types" />
import {
  clampQuestionIndex,
  initialAnswers,
  isAnswerComplete,
  toAnswerDrafts,
  updateAnswer,
} from '@/lib/chat/ask-tool'
import { describe, expect, test } from 'bun:test'

const questions = [
  {
    question: 'Pick one',
    options: [{ label: 'A' }, { label: 'B' }],
  },
  {
    question: 'Pick another',
    options: [{ label: 'C' }, { label: 'D' }],
  },
]

describe('ask tool answer state', () => {
  test('restores valid selection, custom-answer, and note drafts', () => {
    expect(
      initialAnswers(questions, [
        {
          selectedOptionIndex: 1,
          customAnswer: 'unused',
          note: 'context',
          skipped: false,
        },
        {
          selectedOptionIndex: 99,
          customAnswer: 'Custom',
          note: '',
          skipped: true,
        },
      ]),
    ).toEqual([
      {
        selectedOptionIndex: 1,
        customAnswer: 'unused',
        note: 'context',
        skipped: false,
      },
      { customAnswer: 'Custom', note: '', skipped: true },
    ])
  })

  test('keeps custom and note text separate when selection mode changes', () => {
    const initial = [
      { customAnswer: 'Custom draft', note: 'Choice context', skipped: false },
    ]
    const selected = updateAnswer(initial, 0, (response) => ({
      ...response,
      selectedOptionIndex: 0,
    }))

    expect(selected[0]).toEqual({
      selectedOptionIndex: 0,
      customAnswer: 'Custom draft',
      note: 'Choice context',
      skipped: false,
    })
    expect(toAnswerDrafts(selected)).toEqual([
      { questionIndex: 0, selectedOptionIndex: 0, note: 'Choice context' },
    ])
  })

  test('requires nonblank custom text when no choice is selected', () => {
    expect(
      isAnswerComplete({ customAnswer: '   ', note: '', skipped: false }),
    ).toBe(false)
    expect(
      isAnswerComplete({
        customAnswer: 'Different',
        note: '',
        skipped: false,
      }),
    ).toBe(true)
    expect(
      isAnswerComplete({
        selectedOptionIndex: 0,
        customAnswer: '',
        note: '',
        skipped: false,
      }),
    ).toBe(true)
  })

  test('treats skipped questions as complete and serializes the skip', () => {
    const skipped = [{ customAnswer: 'Draft', note: '', skipped: true }]

    expect(isAnswerComplete(skipped[0]!)).toBe(true)
    expect(toAnswerDrafts(skipped)).toEqual([
      { questionIndex: 0, skipped: true },
    ])
  })

  test('clamps restored navigation to available questions', () => {
    expect(clampQuestionIndex(-2, 2)).toBe(0)
    expect(clampQuestionIndex(9, 2)).toBe(1)
  })
})
