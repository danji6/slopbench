import { build } from 'bun'
import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('filesystem tools and stream queries bundle for the Convex default runtime', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const result = await build({
    entrypoints: [
      `${root}packages/convex/src/model/tool/build.ts`,
      `${root}packages/convex/src/streams.ts`,
    ],
    target: 'browser',
    tsconfig: `${root}tsconfig.json`,
  })
  expect(result.logs.filter((entry) => entry.level === 'error')).toEqual([])
  expect(result.success).toBe(true)
})
