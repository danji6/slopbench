import { expect, test } from '@playwright/test'

for (const emptyChanges of [false, true]) {
  test(`completed grouped messages leave no blank space between collapsed work summaries (emptyChanges=${emptyChanges})`, async ({
    page,
  }) => {
    await page.goto(
      `/?fixture=notes&id=notes&groupedWork${emptyChanges ? '&emptyChanges' : ''}`,
    )
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toHaveCount(2)
    await expect
      .poll(async () => {
        const first = await work.nth(0).boundingBox()
        const second = await work.nth(1).boundingBox()
        return first && second ? second.y - first.y - first.height : Infinity
      })
      .toBeLessThanOrEqual(1)
  })
}

test('releases footer height when its duration disappears', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&groupedWork')
  const footer = page.locator('[data-row-kind="footer"]')
  await expect(footer.locator('[data-slow="message-footer"]')).toBeVisible()
  await expect
    .poll(async () => (await footer.boundingBox())?.height ?? 0)
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Hide duration' }).click()
  await expect(footer.locator('[data-slow="message-footer"]')).toHaveCount(0)
  await expect
    .poll(async () => (await footer.boundingBox())?.height ?? Infinity)
    .toBeLessThanOrEqual(1)
})
