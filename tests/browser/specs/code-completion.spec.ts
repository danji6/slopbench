import { type Page, expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'

const editorFor = (page: Page) =>
  page.getByTestId('primary-editor').locator('.ProseMirror')
const popupFor = (page: Page) => page.locator('[data-slot="code-completion"]')

async function setSource(page: Page, marked: string) {
  const offset = marked.indexOf('▌')
  const source = marked.replace('▌', '')
  await page.getByLabel('Source', { exact: true }).fill(source)
  const editor = editorFor(page)
  await expect
    .poll(() =>
      editor.evaluate((element) =>
        (element as HTMLElement & { editor: Editor }).editor.getText({
          blockSeparator: '\n',
        }),
      ),
    )
    .toBe(source)
  await editor.evaluate(
    (element, offset) => {
      const current = (element as HTMLElement & { editor: Editor }).editor
      let remaining = offset
      let position = 1
      current.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return
        if (remaining >= 0 && remaining <= node.textContent.length) {
          position = pos + 1 + remaining
        }
        remaining -= node.textContent.length + 1
        return false
      })
      current.commands.setTextSelection(position)
      current.view.focus()
    },
    offset < 0 ? source.length : offset,
  )
}

async function selectedText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString())
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=code-completion')
  await expect(editorFor(page)).toBeVisible()
})

test('automatically completes locals and supports manual reopening and keyboard selection', async ({
  page,
}) => {
  await setSource(page, 'const cleaned = text.trim();\ncl▌')
  await page.keyboard.type('e')
  await expect(
    page.getByRole('option', { name: 'cleaned variable' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popupFor(page)).toHaveCount(0)
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Saved code')).toHaveText(
    'const cleaned = text.trim();\ncleaned',
  )
  await expect(popupFor(page)).toHaveCount(0)
})

test('argument suggestions preserve quotes and signature help tracks the caret', async ({
  page,
}) => {
  await setSource(page, 'replace(▌)')
  await page.keyboard.press('Control+Space')
  await expect(
    page.getByRole('option', { name: 'paragraph value' }),
  ).toBeVisible()
  await page.getByRole('option', { name: 'paragraph value' }).click()
  await expect(page.getByLabel('Saved code')).toHaveText("replace('paragraph')")
  await page.keyboard.type(', ')
  await expect(page.locator('[data-slot="signature-help"]')).toContainText(
    'Replacement text',
  )
  await expect(
    page.locator('[data-slot="signature-help"] .font-bold'),
  ).toHaveText('value?')
  await page.keyboard.press('ArrowRight')
  await expect(popupFor(page)).toHaveCount(0)
})

test('accepting a function snippet immediately offers argument values', async ({
  page,
}) => {
  await setSource(page, 'rep▌')
  await page.keyboard.press('Control+Space')
  await expect(
    page.getByRole('option', { name: 'replace function' }),
  ).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Saved code')).toHaveText('replace()')
  await expect(
    page.getByRole('option', { name: 'selection value' }),
  ).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Saved code')).toHaveText("replace('paragraph')")
})

test('replaces the full string suffix and keeps its quote style', async ({
  page,
}) => {
  await setSource(page, 'replace("pa▌graph")')
  await page.keyboard.press('Control+Space')
  await page.getByRole('option', { name: 'paragraph value' }).click()
  await expect(page.getByLabel('Saved code')).toHaveText('replace("paragraph")')
})

test('literal dollar identifiers preserve the enclosing snippet navigation', async ({
  page,
}) => {
  await setSource(page, 'const $local = 1;\nwra▌')
  await page.keyboard.press('Control+Space')
  await expect(
    page.getByRole('option', { name: 'wrap function' }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await expect.poll(() => selectedText(page)).toBe('text')
  await page.keyboard.insertText('$l')
  await expect(
    page.getByRole('option', { name: '$local variable' }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await expect.poll(() => selectedText(page)).toBe('message')
  await page.keyboard.insertText('other')
  await page.keyboard.press('Tab')
  await expect.poll(() => selectedText(page)).toBe('')
  await expect(page.getByLabel('Saved code')).toHaveText(
    'const $local = 1;\nwrap($local, other)',
  )
})

test('Escape dismisses suggestions before signature help', async ({ page }) => {
  await setSource(page, 'replace(▌)')
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page).getByRole('option')).toHaveCount(5)
  await page.keyboard.press('Escape')
  await expect(popupFor(page).getByRole('option')).toHaveCount(0)
  await expect(page.locator('[data-slot="signature-help"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popupFor(page)).toHaveCount(0)
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page).getByRole('option')).toHaveCount(5)
})

test('only the focused editor handles completion keys and exposes the active option', async ({
  page,
}) => {
  await setSource(page, 'te▌')
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page)).toBeVisible()
  const editor = editorFor(page)
  const active = await editor.getAttribute('aria-activedescendant')
  expect(active).toBeTruthy()
  expect(
    await page.evaluate((id) => !!document.getElementById(id!), active),
  ).toBe(true)
  await page.getByTestId('other-editor').locator('.ProseMirror').click()
  await expect(popupFor(page)).toHaveCount(0)
  await page.keyboard.type('mes')
  await expect(
    page.getByRole('option', { name: 'message variable' }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(
    page.getByTestId('other-editor').locator('.ProseMirror'),
  ).toHaveText('message')
  await expect(editor).toHaveText('te')
})

test('composition and blur close suggestions, and external source changes resync', async ({
  page,
}) => {
  await setSource(page, 'te▌')
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page)).toBeVisible()
  await editorFor(page).dispatchEvent('compositionstart', { data: '' })
  await expect(popupFor(page)).toHaveCount(0)
  await editorFor(page).dispatchEvent('compositionend', { data: '' })
  await page.getByRole('button', { name: 'Outside editor' }).click()
  await page
    .getByLabel('Source', { exact: true })
    .fill('const replacement = 1;')
  await expect(editorFor(page)).toHaveText('const replacement = 1;')
  await expect(popupFor(page)).toHaveCount(0)
})

test('stale delayed results cannot replace newer suggestions or reopen after blur', async ({
  page,
}) => {
  await page.getByLabel('Delayed provider').check()
  await setSource(page, 'old▌')
  await page.keyboard.press('Control+Space')
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('new')
  await expect(page.getByRole('option', { name: 'newResult' })).toBeVisible()
  await page.waitForTimeout(550)
  await expect(page.getByRole('option', { name: 'oldResult' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Outside editor' }).click()
  await expect(popupFor(page)).toHaveCount(0)
})

test('popup remains within a narrow viewport after resizing and scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 500 })
  await setSource(page, 'replace(▌)')
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page)).toBeVisible()
  await page.evaluate(() => window.scrollBy(0, 40))
  await expect
    .poll(async () => {
      const box = await popupFor(page).boundingBox()
      return (
        !!box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 360 &&
        box.y + box.height <= 500
      )
    })
    .toBe(true)
})

for (const language of ['css', 'json']) {
  test(`${language} editors do not offer JavaScript names`, async ({
    page,
  }) => {
    await page.getByLabel('Language').selectOption(language)
    await setSource(page, 'const local = 1;\nlo▌')
    await page.keyboard.press('Control+Space')
    await expect(popupFor(page)).toHaveCount(0)
  })
}

test('prompt readFile offers wrap choices and literal scope options with active parameter hints', async ({
  page,
}) => {
  await page.getByLabel('Prompt editor', { exact: true }).check()
  await setSource(page, "Intro {{ readFile('notes.md', ▌) }} End")
  await page.keyboard.press('Control+Space')
  await expect(
    page.locator('[data-slot="signature-help"] .font-bold'),
  ).toHaveText('wrap?')
  await page.getByRole('option', { name: 'false value' }).click()
  await expect(editorFor(page)).toHaveText(
    "Intro {{ readFile('notes.md', false) }} End",
  )
  await page.keyboard.type(', ')
  await expect(
    page.locator('[data-slot="signature-help"] .font-bold'),
  ).toHaveText('options?')
  await page.getByRole('option', { name: 'agent value' }).click()
  await expect(editorFor(page)).toHaveText(
    "Intro {{ readFile('notes.md', false, { scope: 'agent' }) }} End",
  )
})

test('prompt fileExists completes scope options across paragraphs', async ({
  page,
}) => {
  await page.getByLabel('Prompt editor', { exact: true }).check()
  await setSource(
    page,
    "Introduction\n#eval\nreturn fileExists('notes.md', ▌)\n#end\nConclusion",
  )
  await page.keyboard.press('Control+Space')
  await expect(page.locator('[data-slot="signature-help"]')).toContainText(
    'fileExists(path, options?)',
  )
  await page.getByRole('option', { name: 'workspace value' }).click()
  await expect
    .poll(() =>
      editorFor(page).evaluate((element) =>
        (element as HTMLElement & { editor: Editor }).editor.getText({
          blockSeparator: '\n',
        }),
      ),
    )
    .toBe(
      "Introduction\n#eval\nreturn fileExists('notes.md', { scope: 'workspace' })\n#end\nConclusion",
    )
})

test('prompt snippet arguments offer hints and completions stay out of prose and file paths', async ({
  page,
}) => {
  await page.getByLabel('Prompt editor', { exact: true }).check()
  await setSource(page, '{{ readF▌ }}')
  await page.keyboard.press('Control+Space')
  await expect(
    page.getByRole('option', { name: 'readFile function' }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await expect.poll(() => selectedText(page)).toBe('path')
  await page.keyboard.insertText('notes.md')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(', ')
  await expect(page.getByRole('option', { name: 'true value' })).toBeVisible()
  await page.getByRole('button', { name: 'Outside editor' }).click()
  await setSource(page, "{{ readFile('model▌') }}")
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page).getByRole('option')).toHaveCount(0)
  await page.getByRole('button', { name: 'Outside editor' }).click()
  await setSource(page, 'plain readF▌')
  await page.keyboard.press('Control+Space')
  await expect(popupFor(page)).toHaveCount(0)
})
