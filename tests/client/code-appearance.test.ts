import { expect, test } from 'bun:test'

test('code appearance rendering, inheritance, and controls', async () => {
  // Other UI tests mock the shared barrel; keep these real rendering checks isolated.
  const child = Bun.spawn(
    ['bun', 'test', './tests/fixtures/code-appearance.fixture.tsx'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [exitCode, output] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ])
  expect(output).toContain('7 pass')
  expect(exitCode).toBe(0)
}, 10_000)
