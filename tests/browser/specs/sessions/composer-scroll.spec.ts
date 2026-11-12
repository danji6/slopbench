import { expect, test } from '@playwright/test'

test('keeps following the bottom across consecutive keyboard sends', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 640 })
  await page.goto('/?fixture=notes&id=notes&composer')
  const editor = page.locator('[data-slot="chat-box"] [contenteditable="true"]')
  await expect(editor).toBeInViewport()

  for (let index = 0; index < 3; index++) {
    const marker = `Message ${index} end`
    await editor.fill(
      `${'A line of text that will wrap. '.repeat(90)}${marker}`,
    )
    await editor.press('Enter')
    await expect(editor).toHaveText('')
    await expect(page.getByText(marker, { exact: false })).toBeAttached()
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - scrollY - innerHeight,
        ),
      )
      .toBeLessThanOrEqual(1)
  }
})

test('into-view mode aligns the submitted message beneath the navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 640 })
  await page.goto('/?fixture=notes&id=notes&composer&intoView')
  const editor = page.locator('[data-slot="chat-box"] [contenteditable="true"]')
  await expect(editor).toBeInViewport()
  await editor.fill(
    `${'A line of text that will wrap. '.repeat(90)}Sent message`,
  )
  await editor.press('Enter')

  const firstRow = page.locator('[data-message-id="sent-32"]').first()
  await expect
    .poll(async () => Math.round((await firstRow.boundingBox())?.y ?? -1))
    .toBe(64)
})
