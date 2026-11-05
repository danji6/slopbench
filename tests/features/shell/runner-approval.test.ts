import {
  analyzeShellCommand,
  analyzeShellPathCandidates,
  isShellCommandAutoApproved,
} from '@sb/convex/lib/tool/approval'
import { describe, expect, test } from 'bun:test'

describe('package and environment runners', () => {
  test.each([
    ['npm run format -- README.md', 'npm run format'],
    ['npm test -- README.md', 'npm test'],
    ['npm exec -- prettier --write README.md', 'npm exec prettier'],
    ['npm exec prettier -- --write README.md', 'npm exec prettier'],
    ['pnpm run format README.md', 'pnpm run format'],
    ['pnpm test README.md', 'pnpm test'],
    ['pnpm exec eslint README.md', 'pnpm exec eslint'],
    ['pnpm dlx prettier README.md', 'pnpm dlx prettier'],
    ['yarn run format README.md', 'yarn run format'],
    ['yarn test README.md', 'yarn test'],
    ['yarn dlx prettier README.md', 'yarn dlx prettier'],
    ['bun run format README.md', 'bun run format'],
    ['bun x prettier README.md', 'bun x prettier'],
    ['npx --yes prettier README.md', 'npx prettier'],
    ['bunx prettier README.md', 'bunx prettier'],
    ['uv run --with "pytest>=8" pytest README.md', 'uv run pytest'],
    ['uv --offline run --locked python -m pytest README.md', 'uv run python'],
    ['uv run -m pytest README.md', 'uv run pytest'],
    ['uv tool run --from pytest pytest README.md', 'uv tool run pytest'],
    ['uvx --from pytest pytest README.md', 'uvx pytest'],
    ['poetry run pytest README.md', 'poetry run pytest'],
  ])('separates task identity and arguments: %s', (command, pattern) => {
    expect(analyzeShellCommand(command, []).patterns).toEqual([pattern])
    expect(isShellCommandAutoApproved(command, [])).toBe(false)
    expect(isShellCommandAutoApproved(command, [pattern])).toBe(true)
    expect(analyzeShellPathCandidates(command)).toEqual({
      candidates: ['README.md'],
      complete: true,
    })
  })

  test('specific task or executable grants do not cover siblings', () => {
    expect(isShellCommandAutoApproved('npm run deploy', ['npm run test'])).toBe(
      false,
    )
    expect(
      isShellCommandAutoApproved('uv run python script.py', ['uv run pytest']),
    ).toBe(false)
  })

  test('runner prefixes cover their tasks and executables', () => {
    expect(
      isShellCommandAutoApproved('bun run tests toolkits', ['bun run']),
    ).toBe(true)
    expect(isShellCommandAutoApproved('npm run lint', ['npm run'])).toBe(true)
    expect(isShellCommandAutoApproved('uv run pytest', ['uv run'])).toBe(true)
    expect(
      isShellCommandAutoApproved('uv tool run pytest', ['uv tool run']),
    ).toBe(true)
  })

  test('prefixes match complete words, including quoted task names', () => {
    expect(isShellCommandAutoApproved('bun runtime tests', ['bun run'])).toBe(
      false,
    )
    expect(
      isShellCommandAutoApproved('bun run tests-extra', ['bun run tests']),
    ).toBe(false)
    expect(
      isShellCommandAutoApproved('bun run "tests extra"', ['bun run tests']),
    ).toBe(false)
    expect(
      isShellCommandAutoApproved('bun run "tests extra" toolkits', [
        'bun run "tests extra"',
      ]),
    ).toBe(true)
    expect(isShellCommandAutoApproved('bun run tests', ['  bun\trun  '])).toBe(
      true,
    )
    expect(isShellCommandAutoApproved('bun run tests', [''])).toBe(false)
  })

  test('runner prefixes still check every chain segment and unsafe syntax', () => {
    const allowlist = ['bun run']
    expect(
      isShellCommandAutoApproved('bun run tests && bun run lint', allowlist),
    ).toBe(true)
    expect(
      analyzeShellCommand('bun run tests && rm output.txt', allowlist)
        .unapproved,
    ).toEqual(['rm'])
    expect(
      isShellCommandAutoApproved('bun run tests && rm output.txt', allowlist),
    ).toBe(false)
    expect(
      isShellCommandAutoApproved('bun run tests > output.txt', allowlist),
    ).toBe(false)
    expect(
      isShellCommandAutoApproved('bun run tests "$(whoami)"', allowlist),
    ).toBe(false)
  })

  test('preserves file-valued options and executable paths', () => {
    expect(
      analyzeShellPathCandidates(
        'uv run --with-requirements requirements.txt python "scripts/check.py" README.md',
      ),
    ).toEqual({
      candidates: ['requirements.txt', 'scripts/check.py', 'README.md'],
      complete: true,
    })
    expect(
      analyzeShellPathCandidates(
        'npx --userconfig=config.ini --package=./local-package prettier README.md',
      ),
    ).toEqual({
      candidates: ['config.ini', './local-package', 'README.md'],
      complete: true,
    })
    expect(
      analyzeShellPathCandidates('uv run ./scripts/check.py README.md'),
    ).toEqual({
      candidates: ['./scripts/check.py', 'README.md'],
      complete: true,
    })
    expect(
      analyzeShellPathCandidates('uv run python -c \'print(".git/config")\''),
    ).toEqual({ candidates: [], complete: true })
  })

  test('retains command-specific path checks through execution wrappers', () => {
    expect(
      analyzeShellPathCandidates('uv run grep -f.git/config README.md'),
    ).toEqual({ candidates: ['.git/config', 'README.md'], complete: true })
    expect(analyzeShellPathCandidates('npm run test -- -- -notes')).toEqual({
      candidates: ['-notes'],
      complete: true,
    })
  })

  test('keeps forwarded interpreter flags inside the launched command', () => {
    const command = 'bun x node -e \'console.log(".git/config")\''
    expect(analyzeShellCommand(command, []).patterns).toEqual(['bun x node'])
    expect(analyzeShellPathCandidates(command)).toEqual({
      candidates: [],
      complete: true,
    })
  })

  test.each([
    'npm --workspace=other run test',
    'npm run test --workspace=other',
    'npm exec -c "echo opaque" tool',
    'pnpm --filter "**/ignored/**" run test',
    'yarn --cwd ignored run test',
    'yarn run build:client README.md',
    'uv run --directory ignored pytest',
    'uv run --project ignored pytest',
    'uv run --with "pkg @ file:///outside" pytest',
    'npx --package file:../outside tool',
    'npx file:../outside',
    'uv run --with-requirements',
    'uv run --future-option value pytest',
    'uv run',
    'npm run',
    'uv run https://example.com/script.py',
    'uv run uv run uv run uv run uv run uv run pytest',
  ])('requires approval when interpretation is incomplete: %s', (command) => {
    expect(analyzeShellPathCandidates(command).complete).toBe(false)
  })
})
