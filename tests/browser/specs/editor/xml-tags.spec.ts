import { type Locator, expect, test } from '@playwright/test'
import type { Editor, JSONContent } from '@tiptap/core'

async function setContent(
  target: Locator,
  content: JSONContent,
  offset: number,
) {
  await target.evaluate(
    (element, { content, offset }) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      editor.commands.setContent({ type: 'doc', content: [content] })
      editor.commands.setTextSelection(offset + 1)
      editor.view.focus()
    },
    { content, offset },
  )
}

function paragraph(text: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=xml-tags')
  await expect(
    page.getByTestId('composer').locator('.ProseMirror'),
  ).toBeVisible()
  await expect(page.getByTestId('code').locator('.ProseMirror')).toBeVisible()
})

for (const name of ['div', 'custom-tag', 'system-reminder']) {
  test(`native typing closes ${name} at the caret`, async ({ page }) => {
    await page.getByTestId('composer').locator('.ProseMirror').click()
    await page.keyboard.type(`<${name}>body`)
    await expect(page.getByLabel('Saved markdown')).toHaveText(
      `<${name}>body</${name}>`,
    )
  })
}

for (const invertSend of [false, true]) {
  test(`composer keeps its send chord and expands with its newline chord (invert=${invertSend})`, async ({
    page,
  }) => {
    await page.getByLabel('Send with Shift+Enter').setChecked(invertSend)
    const editor = page.getByTestId('composer').locator('.ProseMirror')
    await editor.click()
    await page.keyboard.type('<custom-tag>')
    const send = invertSend ? 'Shift+Enter' : 'Enter'
    const newline = invertSend ? 'Enter' : 'Shift+Enter'
    await page.keyboard.press(send)
    await expect(page.getByLabel('Sends')).toHaveText('1')
    await expect(page.getByLabel('Saved markdown')).toHaveText(
      '<custom-tag></custom-tag>',
    )
    await page.keyboard.press(newline)
    await page.keyboard.type('body')
    await expect(page.getByLabel('Saved markdown')).toHaveText(
      '<custom-tag>\n  body\n</custom-tag>',
    )
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(page.getByLabel('Sends')).toHaveText('2')
  })
}

test('standalone JavaScript code editor closes tags, indents pairs, and supports undo/redo', async ({
  page,
}) => {
  const editor = page.getByTestId('code').locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('  <ns:Custom title="a > b">')
  await expect(page.getByLabel('Saved code')).toHaveText(
    '  <ns:Custom title="a > b"></ns:Custom>',
  )
  await page.keyboard.press('Enter')
  await page.keyboard.type('body')
  await expect(page.getByLabel('Saved code')).toHaveText(
    '  <ns:Custom title="a > b">\n    body\n  </ns:Custom>',
  )
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByLabel('Saved code')).toHaveText(
    '  <ns:Custom title="a > b">\n    \n  </ns:Custom>',
  )
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByLabel('Saved code')).toHaveText(
    '  <ns:Custom title="a > b"></ns:Custom>',
  )
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.getByLabel('Saved code')).toHaveText(
    '  <ns:Custom title="a > b">\n    \n  </ns:Custom>',
  )
})

test('inline source and fenced code keep their XML source editable', async ({
  page,
}) => {
  const editor = page.getByTestId('composer').locator('.ProseMirror')
  await setContent(editor, paragraph('`<tag`'), 5)
  await page.keyboard.type('>body')
  await expect(page.getByLabel('Saved markdown')).toHaveText(
    '`<tag>body</tag>`',
  )
  await setContent(
    editor,
    {
      type: 'codeBlock',
      attrs: { language: 'xml' },
      content: [{ type: 'text', text: '<tag' }],
    },
    4,
  )
  await page.keyboard.type('>')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('body')
  await expect(page.getByLabel('Saved markdown')).toHaveText(
    '```xml\n<tag>\n  body\n</tag>\n```',
  )
})

test('typing beside hidden Markdown delimiters still reaches XML input handling', async ({
  page,
}) => {
  const editor = page.getByTestId('composer').locator('.ProseMirror')
  await setContent(editor, paragraph('**<tag**'), 6)
  await page.keyboard.type('>body')
  await expect(page.getByLabel('Saved markdown')).toHaveText(
    '**<tag>body</tag>**',
  )
})
