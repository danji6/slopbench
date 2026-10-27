import { expect, test } from '@playwright/test'

test('wrapped labels stay close to their checkbox and centered after resizing', async ({
  page,
}) => {
  await page.goto('/?fixture=checkbox')
  const checkbox = page.getByRole('checkbox')
  await expect(checkbox).toBeVisible()

  for (const width of [440, 320, 220, 440]) {
    await page.setViewportSize({ width, height: 500 })
    await expect
      .poll(async () =>
        page.getByTestId('container').evaluate((container) => {
          const label = container.querySelector('label')!
          const control = label.querySelector('[data-slot="checkbox"]')!
          const text = label.lastElementChild!
          const range = document.createRange()
          range.selectNodeContents(text)
          const lines = Array.from(range.getClientRects())
          const textLeft = Math.min(...lines.map((line) => line.left))
          const textRight = Math.max(...lines.map((line) => line.right))
          const box = control.getBoundingClientRect()
          const bounds = container.getBoundingClientRect()
          return {
            close: textLeft - box.right >= 7 && textLeft - box.right <= 10,
            centered:
              Math.abs(
                (box.left + textRight) / 2 - (bounds.left + bounds.right) / 2,
              ) <= 2,
            fits: textRight <= bounds.right && box.left >= bounds.left,
            wrapped: lines.length > 1,
          }
        }),
      )
      .toEqual({
        close: true,
        centered: true,
        fits: true,
        wrapped: width < 440,
      })
    if (width === 320) {
      await page.screenshot({
        path: '/tmp/slopbench-checkbox-label-wrapped.png',
      })
    }
  }

  await page
    .getByText('Also delete the managed folder and its contents')
    .click()
  await expect(checkbox).toBeChecked()
  await page.screenshot({ path: '/tmp/slopbench-checkbox-label.png' })
})
