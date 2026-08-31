/// <reference types="bun-types" />
import {
  askBlockLabel,
  clampQuestionIndex,
  initialAnswers,
  isAnswerComplete,
  toAnswerDrafts,
  toggleAnswerOption,
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
  test('hides the count until streamed question input is complete', () => {
    expect(askBlockLabel('input-streaming', 0, false)).toBe('Asking questions…')
    expect(askBlockLabel('input-available', 2, false)).toBe('Asked 2 questions')
    expect(askBlockLabel('output-available', 1, true)).toBe(
      'Answered 1 question',
    )
  })

  test('restores valid selection, custom-answer, and note drafts', () => {
    expect(
      initialAnswers(questions, [
        {
          selectedOptionIndices: [1],
          customAnswer: 'unused',
          note: 'context',
          skipped: false,
        },
        {
          selectedOptionIndices: [99],
          customAnswer: 'Custom',
          note: '',
          skipped: true,
        },
      ]),
    ).toEqual([
      {
        selectedOptionIndices: [1],
        customAnswer: 'unused',
        note: 'context',
        skipped: false,
      },
      {
        selectedOptionIndices: [],
        customAnswer: 'Custom',
        note: '',
        skipped: true,
      },
    ])
  })

  test('keeps custom and note text separate when selection mode changes', () => {
    const initial = [
      {
        selectedOptionIndices: [],
        customAnswer: 'Custom draft',
        note: 'Choice context',
        skipped: false,
      },
    ]
    const selected = updateAnswer(initial, 0, (response) => ({
      ...response,
      selectedOptionIndices: [0],
    }))

    expect(selected[0]).toEqual({
      selectedOptionIndices: [0],
      customAnswer: 'Custom draft',
      note: 'Choice context',
      skipped: false,
    })
    expect(toAnswerDrafts(selected)).toEqual([
      {
        questionIndex: 0,
        selectedOptionIndices: [0],
        note: 'Choice context',
      },
    ])
  })

  test('requires nonblank custom text when no choice is selected', () => {
    expect(
      isAnswerComplete({
        selectedOptionIndices: [],
        customAnswer: '   ',
        note: '',
        skipped: false,
      }),
    ).toBe(false)
    expect(
      isAnswerComplete({
        selectedOptionIndices: [],
        customAnswer: 'Different',
        note: '',
        skipped: false,
      }),
    ).toBe(true)
    expect(
      isAnswerComplete({
        selectedOptionIndices: [0],
        customAnswer: '',
        note: '',
        skipped: false,
      }),
    ).toBe(true)
  })

  test('treats skipped questions as complete and serializes the skip', () => {
    const skipped = [
      {
        selectedOptionIndices: [],
        customAnswer: 'Draft',
        note: '',
        skipped: true,
      },
    ]

    expect(isAnswerComplete(skipped[0]!)).toBe(true)
    expect(toAnswerDrafts(skipped)).toEqual([
      { questionIndex: 0, skipped: true },
    ])
  })

  test('clamps restored navigation to available questions', () => {
    expect(clampQuestionIndex(-2, 2)).toBe(0)
    expect(clampQuestionIndex(9, 2)).toBe(1)
  })

  test('toggles one or several options according to the question mode', () => {
    const empty = {
      selectedOptionIndices: [],
      customAnswer: '',
      note: '',
      skipped: false,
    }
    const single = toggleAnswerOption(empty, 0, false)
    expect(toggleAnswerOption(single, 1, false).selectedOptionIndices).toEqual([
      1,
    ])
    expect(toggleAnswerOption(single, 0, false).selectedOptionIndices).toEqual(
      [],
    )

    const first = toggleAnswerOption(empty, 0, true)
    const both = toggleAnswerOption(first, 1, true)
    expect(both.selectedOptionIndices).toEqual([0, 1])
    expect(toggleAnswerOption(both, 0, true).selectedOptionIndices).toEqual([1])
  })
})
