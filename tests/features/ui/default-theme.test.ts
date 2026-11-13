import { exportSchemeCss } from '@/lib/theme'
import type { Doc, Id } from '@cv/convex/_generated/dataModel'
import type { AuthMutationCtx } from '@cv/convex/functions'
import { SOURCE_COLOR } from '@cv/convex/model/defaults'
import { getOrDefault, update } from '@cv/convex/model/settings'
import { expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const ownerId = 'owner' as Id<'users'>
const settingsId = 'settings' as Id<'settings'>

test('both CSS palettes match the default source color used by settings', () => {
  const stylesheet = new URL(
    '../../../packages/client/src/styles/theme.css',
    import.meta.url,
  )
  const css = readFileSync(stylesheet, 'utf8')

  for (const mode of ['light', 'dark']) {
    const palette = css
      .split(`/* Begin generated ${mode} palette */`)[1]
      ?.split(`/* End generated ${mode} palette */`)[0]
    expect(palette).toBeDefined()

    const declarations = palette!.matchAll(/(--[a-z-]+): (#[a-f0-9]{6});/g)
    const actual = Object.fromEntries(
      Array.from(declarations, ([, token, value]) => [token, value]),
    )
    expect(actual).toEqual(
      exportSchemeCss(SOURCE_COLOR, mode === 'dark', 0).css,
    )
  }
})

function context(theme?: Doc<'settings'>['theme']) {
  const patch = mock(async () => {})
  const ctx = {
    userId: ownerId,
    db: {
      query: () => ({
        withIndex: () => ({
          unique: async () => ({
            _id: settingsId,
            _creationTime: 0,
            ownerId,
            theme,
          }),
        }),
      }),
      patch,
    },
  } as unknown as AuthMutationCtx
  return { ctx, patch }
}

test('a saved pre-release default falls back to the current default color', async () => {
  const source = '#8A771D'
  const legacy = {
    source,
    light: exportSchemeCss(source, false, 0).css,
    dark: exportSchemeCss(source, true, 0).css,
  }
  const { ctx } = context(legacy)

  expect((await getOrDefault(ctx)).theme).toBeUndefined()
})

test('a custom theme survives unrelated settings updates and can be cleared', async () => {
  const custom = { source: '#006c4c', light: {}, dark: {} }
  const { ctx, patch } = context(custom)

  expect((await getOrDefault(ctx)).theme).toEqual(custom)

  await update(ctx, { patch: { themeMode: 'light' } })
  expect(patch).toHaveBeenNthCalledWith(1, settingsId, { themeMode: 'light' })

  await update(ctx, { patch: { theme: null } })
  expect(patch).toHaveBeenNthCalledWith(2, settingsId, { theme: undefined })
})
