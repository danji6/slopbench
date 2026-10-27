import { build } from 'bun'
import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('filesystem tools and stream queries bundle for the Convex default runtime', async () => {
  const result = await build({
    entrypoints: [
      fileURLToPath(import.meta.resolve('@sb/convex/model/tool/build')),
      fileURLToPath(import.meta.resolve('@sb/convex/streams')),
    ],
    target: 'browser',
    tsconfig: fileURLToPath(import.meta.resolve('~/tsconfig.json')),
  })
  expect(result.logs.filter((entry) => entry.level === 'error')).toEqual([])
  expect(result.success).toBe(true)
})
