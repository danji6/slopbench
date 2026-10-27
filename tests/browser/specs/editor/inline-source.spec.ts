import { expect, test } from '@playwright/test'
import type { SourceFixtureWindow } from '~/tests/browser/inline-source-fixture'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=inline-source')
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () => !!(window as SourceFixtureWindow).sourceFixtureEditor,
      ),
    )
    .toBe(true)
})

test('clicking nested text reveals its enclosing source without content updates', async ({
  page,
}) => {
  const editor = page.locator('.ProseMirror')
  await expect(editor.locator('[data-source-hidden]')).toHaveCount(6)
  await editor.locator('.md-source-italic').click()
  await expect(editor.locator('[data-source-hidden]')).toHaveCount(2)
  await expect(page.getByLabel('Content updates')).toHaveText('0')
  await page.keyboard.type('X')
  await expect(page.getByLabel('Saved markdown')).toContainText('X')
  await page.getByRole('button', { name: 'Outside editor' }).click()
  await expect(editor.locator('[data-source-hidden]')).toHaveCount(6)
})

test('the caret stays visible while editing inline code', async ({ page }) => {
  await page.evaluate(() => {
    const editor = (window as SourceFixtureWindow).sourceFixtureEditor!
    editor.commands.setContent('before `testing` after', {
      contentType: 'markdown',
    })
    editor.commands.setTextSelection(12)
    editor.view.focus()
  })
  // Keep the native caret in its visible blink phase for the pixel comparison.
  await page.addStyleTag({
    content: '.ProseMirror { caret-animation: manual; }',
  })
  const editor = page.locator('.ProseMirror')
  await expect(editor.locator('[data-source-hidden]')).toHaveCount(0)
  const clip = await page.evaluate(() => {
    const current = (window as SourceFixtureWindow).sourceFixtureEditor!
    const { left, top, bottom } = current.view.coordsAtPos(12)
    return {
      x: Math.floor(left),
      y: Math.ceil(top) + 3,
      width: 2,
      height: Math.floor(bottom - top) - 6,
    }
  })
  const withCaret = await page.screenshot({ caret: 'initial', clip })
  const withoutCaret = await page.screenshot({ caret: 'hide', clip })
  expect(withCaret.equals(withoutCaret)).toBe(false)
  await page.keyboard.type('X')
  await expect(page.getByLabel('Saved markdown')).toHaveText(
    'before `tesXting` after',
  )
})

for (const direction of ['ArrowLeft', 'ArrowRight']) {
  test(`${direction} enters between the asterisks and traverses every source character`, async ({
    page,
  }) => {
    const backwards = direction === 'ArrowLeft'
    const start = backwards ? 9 : 1
    const editor = page.locator('.ProseMirror')
    await page.evaluate((start) => {
      const current = (window as SourceFixtureWindow).sourceFixtureEditor!
      current
        .chain()
        .setContent('**word**', { contentType: 'markdown' })
        .setMeta('addToHistory', false)
        .run()
      current.commands.setTextSelection(start)
      current.view.focus()
    }, start)
    const updates = await page.getByLabel('Content updates').textContent()
    await expect(editor.locator('[data-source-hidden]')).toHaveCount(2)
    await page.keyboard.press(direction)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const current = (window as SourceFixtureWindow).sourceFixtureEditor!
          const selection = window.getSelection()!
          return {
            pos: current.state.selection.from,
            text: selection.anchorNode?.textContent,
            offset: selection.anchorOffset,
          }
        }),
      )
      .toEqual({ pos: backwards ? 8 : 2, text: '**', offset: 1 })
    await expect(editor.locator('[data-source-hidden]')).toHaveCount(0)
    for (let step = 2; step <= 8; step++) {
      await page.keyboard.press(direction)
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as SourceFixtureWindow).sourceFixtureEditor!.state
                .selection.from,
          ),
        )
        .toBe(start + (backwards ? -step : step))
      await expect(editor.locator('[data-source-hidden]')).toHaveCount(
        step === 8 ? 2 : 0,
      )
    }
    await expect(page.getByLabel('Saved markdown')).toHaveText('**word**')
    await expect(page.getByLabel('Content updates')).toHaveText(updates!)
    expect(
      await page.evaluate(() =>
        (window as SourceFixtureWindow).sourceFixtureEditor!.commands.undo(),
      ),
    ).toBe(false)
  })
}

for (const [key, pos, expected] of [
  ['Backspace', 9, '**word*'],
  ['Delete', 7, '**word*'],
  ['Delete', 1, '*word**'],
  ['Backspace', 3, '*word**'],
  ['Backspace', 8, '**word*'],
  ['Delete', 2, '*word**'],
] as const) {
  test(`${key} at source position ${pos} removes one marker character and supports undo`, async ({
    page,
  }) => {
    await page.evaluate((pos) => {
      const editor = (window as SourceFixtureWindow).sourceFixtureEditor!
      editor
        .chain()
        .setContent('**word**', { contentType: 'markdown' })
        .setMeta('addToHistory', false)
        .run()
      editor.commands.setTextSelection(pos)
      editor.view.focus()
    }, pos)
    await page.keyboard.press(key)
    await expect(page.getByLabel('Saved markdown')).toHaveText(expected)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByLabel('Saved markdown')).toHaveText('**word**')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(page.getByLabel('Saved markdown')).toHaveText(expected)
  })
}

for (const [inputType, pos, expected] of [
  ['deleteContentBackward', 9, '**word*'],
  ['deleteContentForward', 1, '*word**'],
] as const) {
  test(`${inputType} deletes one hidden symbol through beforeinput`, async ({
    page,
  }) => {
    await page.evaluate((pos) => {
      const editor = (window as SourceFixtureWindow).sourceFixtureEditor!
      editor.commands.setContent('**word**', { contentType: 'markdown' })
      editor.commands.setTextSelection(pos)
      editor.view.focus()
    }, pos)
    await page.locator('.ProseMirror').evaluate((element, inputType) => {
      element.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, inputType)
    await expect(page.getByLabel('Saved markdown')).toHaveText(expected)
  })
}

test('deletion beside word edges preserves the other source characters', async ({
  page,
}) => {
  const source = 'a **word** z'
  for (const key of ['Backspace', 'Delete']) {
    const positions =
      key === 'Backspace' ? [3, 6, 7, 8, 9, 12] : [2, 5, 6, 7, 8, 11]
    for (const pos of positions) {
      await page.evaluate((pos) => {
        const editor = (window as SourceFixtureWindow).sourceFixtureEditor!
        editor.commands.setContent('a **word** z', { contentType: 'markdown' })
        editor.commands.setTextSelection(pos)
        editor.view.focus()
      }, pos)
      await page.keyboard.press(key)
      const removed = pos - (key === 'Backspace' ? 2 : 1)
      await expect(page.getByLabel('Saved markdown')).toHaveText(
        source.slice(0, removed) + source.slice(removed + 1),
      )
    }
  }
})

test('keyboard formatting creates editable source and composition inserts once', async ({
  page,
}) => {
  const editor = page.locator('.ProseMirror')
  await page.evaluate(() => {
    const current = (window as SourceFixtureWindow).sourceFixtureEditor!
    current.commands.setContent('word', { contentType: 'markdown' })
    current.commands.selectAll()
    current.view.focus()
  })
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.getByLabel('Saved markdown')).toHaveText('**word**')
  await page.keyboard.press('ArrowRight')
  await editor.dispatchEvent('compositionstart', { data: '' })
  await page.keyboard.insertText('漢')
  await editor.dispatchEvent('compositionend', { data: '漢' })
  await expect(page.getByLabel('Saved markdown')).toHaveText('**word漢**')
})

test('drag selection reveals touched syntax and copying uses exact source', async ({
  page,
}) => {
  const editor = page.locator('.ProseMirror')
  const nested = await editor.locator('.md-source-italic').boundingBox()
  const other = await editor.locator('.md-source-strike').boundingBox()
  expect(nested).not.toBeNull()
  expect(other).not.toBeNull()
  await page.mouse.move(nested!.x + 2, nested!.y + nested!.height / 2)
  await page.mouse.down()
  await page.mouse.move(other!.x + other!.width, other!.y + other!.height / 2, {
    steps: 20,
  })
  await page.mouse.up()
  await expect(editor.locator('[data-source-hidden]')).toHaveCount(0)
  const copied = await page.evaluate(() => {
    const current = (window as SourceFixtureWindow).sourceFixtureEditor!
    current.commands.setContent('**word**', { contentType: 'markdown' })
    current.commands.setTextSelection({ from: 3, to: 5 })
    let text: string | undefined
    current.view.someProp('clipboardTextSerializer', (serialize) => {
      text = serialize(current.state.selection.content(), current.view)
      return true
    })
    return text
  })
  expect(copied).toBe('wo')
})

test('long documents retain source during navigation and render the edited span', async ({
  page,
}) => {
  const metrics = await page.evaluate(() => {
    const editor = (window as SourceFixtureWindow).sourceFixtureEditor!
    const source =
      'A **bold** and *italic* sentence with `code` and ~~strike~~.\n'.repeat(
        500,
      )
    editor.commands.setContent(source, { contentType: 'markdown' })
    editor.view.focus()
    const before = JSON.stringify(editor.getJSON())
    const start = performance.now()
    for (let pos = 20; pos <= 400; pos += 20)
      editor.commands.setTextSelection(pos)
    const averageNavigationMs = (performance.now() - start) / 20
    const preserved = JSON.stringify(editor.getJSON()) === before
    const editStart = performance.now()
    editor.view.dispatch(editor.state.tr.insertText('X', 7))
    return {
      preserved,
      characters: source.length,
      averageNavigationMs,
      editMs: performance.now() - editStart,
    }
  })
  expect(metrics.preserved).toBe(true)
  await expect(page.locator('.md-source-bold').first()).toHaveText('boXld')
  console.info('Inline-source browser timings:', metrics)
})

for (const source of [
  '**test**',
  '__test__',
  '*test*',
  '~~test~~',
  '`test`',
  '***test***',
  'before **test**',
]) {
  test(`typing ${source} keeps the caret after the completed source`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      const editor = (window as SourceFixtureWindow).sourceFixtureEditor!
      editor.commands.setContent('', { contentType: 'markdown' })
      editor.view.focus()
    })
    let typed = ''
    for (const character of source) {
      typed += character
      await page.keyboard.type(character)
      await expect
        .poll(() =>
          page.evaluate(() => {
            const editor = (window as SourceFixtureWindow).sourceFixtureEditor!
            return {
              text: editor.state.doc.textContent,
              pos: editor.state.selection.from,
            }
          }),
        )
        .toEqual({ text: typed, pos: typed.length + 1 })
    }
    const editor = page.locator('.ProseMirror')
    const markers = source === '***test***' ? 4 : 2
    await expect(editor.locator('[data-source-hidden]')).toHaveCount(markers)
    await page.keyboard.press('ArrowLeft')
    await expect(editor.locator('[data-source-hidden]')).toHaveCount(0)
    await page.keyboard.press('ArrowRight')
    await expect(editor.locator('[data-source-hidden]')).toHaveCount(markers)
    await page.keyboard.type(' next')
    await expect(page.getByLabel('Saved markdown')).toHaveText(`${source} next`)
  })
}
