/// <reference types="bun-types" />
import {
  applyEdits,
  createUnifiedDiff,
  isUnchangedWrite,
} from '@sb/core/workspace/edit'
import { describe, expect, test } from 'bun:test'

describe('workspace edit helper', () => {
  test('applies multiple edits against the original content', () => {
    const content = 'alpha\nbeta\ngamma\n'

    expect(
      applyEdits(
        content,
        [
          { oldText: 'alpha\n', newText: 'beta\n' },
          { oldText: 'beta\n', newText: 'BETA\n' },
        ],
        'file.txt',
      ),
    ).toBe('beta\nBETA\ngamma\n')
  })

  test('reports duplicate oldText with occurrence count', () => {
    expect(() =>
      applyEdits(
        'static gboolean on_drag();\nstatic gboolean on_drag() {}\n',
        [
          {
            oldText: 'static gboolean on_drag(',
            newText: 'static void replacement(',
          },
        ],
        'monitor.c',
      ),
    ).toThrow(
      'Found 2 occurrences of the text in monitor.c. The text must be unique.',
    )
  })

  test('rejects overlapping edits before making replacements', () => {
    expect(() =>
      applyEdits(
        'one\ntwo\nthree\n',
        [
          { oldText: 'one\ntwo\n', newText: 'ONE\nTWO\n' },
          { oldText: 'two\nthree\n', newText: 'TWO\nTHREE\n' },
        ],
        'file.txt',
      ),
    ).toThrow(
      'edits[0] and edits[1] overlap in file.txt. Merge them into one edit or target disjoint regions.',
    )
  })

  test('emits a unified hunk with context for an insertion', () => {
    expect(
      createUnifiedDiff(
        'monitor.c',
        '#include "monitor.h"\n//\n// Definitions\n',
        '#include "monitor.h"\n#include "buttonbar.h"\n//\n// Definitions\n',
      ),
    ).toBe(
      `--- monitor.c
+++ monitor.c
@@ -1,4 +1,5 @@
 #include "monitor.h"
+#include "buttonbar.h"
 //
 // Definitions
 `,
    )
  })

  test('emits a unified hunk with context for a deletion', () => {
    expect(
      createUnifiedDiff('file.txt', 'alpha\nbeta\ngamma\n', 'alpha\ngamma\n'),
    ).toBe(
      `--- file.txt
+++ file.txt
@@ -1,4 +1,3 @@
 alpha
-beta
 gamma
 `,
    )
  })

  test('splits distant changes into separate hunks', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
    const original = lines.join('\n')
    const updated = lines
      .map((line, i) =>
        i === 2 ? 'CHANGED 3' : i === 16 ? 'CHANGED 17' : line,
      )
      .join('\n')

    const diff = createUnifiedDiff('big.txt', original, updated)
    const headers = diff.split('\n').filter((l) => l.startsWith('@@'))

    expect(headers).toEqual(['@@ -1,6 +1,6 @@', '@@ -14,7 +14,7 @@'])
    expect(diff).toContain('-line 3')
    expect(diff).toContain('+CHANGED 3')
    expect(diff).toContain('-line 17')
    expect(diff).toContain('+CHANGED 17')
    // Untouched distant lines are not part of either hunk.
    expect(diff).not.toContain(' line 10')
  })
})

describe('isUnchangedWrite', () => {
  test('detects identical content', () => {
    expect(isUnchangedWrite('alpha\nbeta\n', 'alpha\nbeta\n')).toBe(true)
  })

  test('ignores line-ending and BOM differences', () => {
    expect(isUnchangedWrite('alpha\r\nbeta\r\n', 'alpha\nbeta\n')).toBe(true)
    expect(isUnchangedWrite('﻿alpha\n', 'alpha\n')).toBe(true)
  })

  test('reports a real content change', () => {
    expect(isUnchangedWrite('alpha\nbeta\n', 'alpha\nBETA\n')).toBe(false)
  })
})
