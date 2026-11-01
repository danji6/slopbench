import {
  analyzeShellPathCandidates,
  isReadOnlyShellCommand,
} from '@sb/convex/lib/tool/approval'
import { describe, expect, test } from 'bun:test'
import { REPORTED_APPROVAL_COMMANDS } from '~/tests/helpers/approval-commands'

describe('shell path option classification', () => {
  test('separates Bun task names and test filters from paths', () => {
    const command =
      "bun format src/widget.tsx tests/widget.test.tsx && bun test --isolate --path-ignore-patterns '**/browser/**' ./tests/widget.test.tsx"
    expect(isReadOnlyShellCommand(command)).toBe(false)
    expect(analyzeShellPathCandidates(command)).toEqual({
      candidates: [
        'src/widget.tsx',
        'tests/widget.test.tsx',
        './tests/widget.test.tsx',
      ],
      complete: true,
    })
    expect(
      analyzeShellPathCandidates(
        'bun --no-env-file test -t "widget renders" --timeout=5000 README.md',
      ),
    ).toEqual({ candidates: ['README.md'], complete: true })
    expect(analyzeShellPathCandidates('bun test -t --cwd README.md')).toEqual({
      candidates: ['README.md'],
      complete: true,
    })
  })

  test('keeps Bun configuration, preload, and output paths', () => {
    expect(
      analyzeShellPathCandidates(
        'bun --config bunfig.toml test --preload=setup.ts --reporter junit --reporter-outfile report.xml widget.test.ts',
      ),
    ).toEqual({
      candidates: ['bunfig.toml', 'widget.test.ts', 'setup.ts', 'report.xml'],
      complete: true,
    })
    expect(
      analyzeShellPathCandidates('bun format --config=.git/config src'),
    ).toEqual({ candidates: ['.git/config', 'src'], complete: true })
  })

  test.each([
    'bun test --preload',
    'bun test --unknown=path',
    'bun --cwd src test ignored.test.ts',
    'bun test --cwd=src ignored.test.ts',
    'bun --cwd src format ignored.ts',
  ])('keeps unclassified Bun test flags approval-gated: %s', (command) => {
    expect(analyzeShellPathCandidates(command).complete).toBe(false)
  })

  test.each(REPORTED_APPROVAL_COMMANDS)(
    'classifies reported command: $command',
    ({ command, candidates }) => {
      expect(isReadOnlyShellCommand(command)).toBe(true)
      expect(analyzeShellPathCandidates(command)).toEqual({
        candidates,
        complete: true,
      })
    },
  )

  test.each([
    'head -n 50 README.md',
    'head -n50 README.md',
    'head --lines=50 README.md',
    'head --lines 50 README.md',
    'head -c 50 README.md',
    'head -c50 README.md',
    'head --bytes=50 README.md',
    'head -qn50 README.md',
    'head -50 README.md',
    'ls --color=auto README.md',
    'ls --color README.md',
    'ls -I "*.js" README.md',
    'ls -laI*.js README.md',
    'ls --ignore="*.js" README.md',
    'ls --hide "*.js" README.md',
    'ls --block-size 50 README.md',
    'ls -w50 README.md',
    'grep -efoo README.md',
    'grep -inefoo README.md',
    'grep -A20 foo README.md',
    'grep -inA 20 foo README.md',
    'grep -m1 foo README.md',
    'grep -20 foo README.md',
    'egrep -inefoo README.md',
    'fgrep -efoo README.md',
    'grep -e foo README.md',
    'grep README.md -e foo',
    'grep --regexp=foo README.md',
    'rg -l needle README.md',
    'rg --files-with-matches needle README.md',
    'rg --files README.md',
    'rg -g*.md needle README.md',
    'rg -tmd needle README.md',
    'rg --files --glob="*.md" README.md',
    'rg --color=auto needle README.md',
    'rg --smart-case --no-filename needle README.md',
  ])('excludes option data: %s', (command) => {
    expect(analyzeShellPathCandidates(command)).toEqual({
      candidates: ['README.md'],
      complete: true,
    })
  })

  test.each([
    'grep -f patterns.txt README.md',
    'grep -fpatterns.txt README.md',
    'grep -if patterns.txt README.md',
    'grep -ifpatterns.txt README.md',
    'grep --file=patterns.txt README.md',
    'grep --file patterns.txt README.md',
    'rg -ifpatterns.txt README.md',
    'rg --file patterns.txt README.md',
    'grep --exclude-from patterns.txt needle README.md',
    'rg --ignore-file patterns.txt needle README.md',
  ])('checks pattern and ignore files: %s', (command) => {
    expect(analyzeShellPathCandidates(command)).toEqual({
      candidates: ['patterns.txt', 'README.md'],
      complete: true,
    })
  })

  test.each([
    ['head -- -notes', ['-notes']],
    ['ls -- -notes', ['-notes']],
    ['ls -- -', ['./-']],
    ['grep -- needle -notes', ['-notes']],
    ['grep -e needle -- -notes', ['-notes']],
    ['rg --files -- -notes', ['-notes']],
    ['rg -- --files README.md', ['README.md']],
    ['rg -e --files README.md', ['README.md']],
    ['head -n 50 -', []],
  ] as const)('respects operands and stdin: %s', (command, candidates) => {
    expect(analyzeShellPathCandidates(command)).toEqual({
      candidates: [...candidates],
      complete: true,
    })
  })

  test.each([
    'head -n',
    'head -c',
    'head --lines',
    'ls -I',
    'ls --ignore',
    'grep -ie',
    'grep -if',
    'grep -inA',
    'grep --file',
    'rg -g',
    'rg --ignore-file',
    'head --future-option README.md',
    'ls --future-option README.md',
    'grep --future-option needle README.md',
    'rg --pre=custom needle README.md',
  ])(
    'fails closed for missing values or unsupported options: %s',
    (command) => {
      expect(analyzeShellPathCandidates(command).complete).toBe(false)
    },
  )
})
