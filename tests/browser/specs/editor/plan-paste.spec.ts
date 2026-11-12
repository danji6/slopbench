import { expect, test } from '@playwright/test'

test('the session plan keeps pasted blank lines after saving and reopening', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&plan')
  await page.getByRole('button', { name: 'Inspect', exact: true }).click()
  const edit = page.getByRole('button', { name: 'Edit', exact: true })
  await edit.click()
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData(
      'text/plain',
      'First step\n\nSecond step\n\n\n\nThird step',
    )
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    )
  })

  await expect(editor.locator('br')).toHaveCount(6)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await edit.click()
  await expect(editor).toHaveText('First stepSecond stepThird step')
  await expect(editor.locator('br')).toHaveCount(6)
})
