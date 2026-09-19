import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=scroll')
})

test('explicit seek wins over following and stays at its anchor', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Seek 20', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('[data-message-id="m20"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBe(64)
  await page.getByRole('button', { name: 'Stream off' }).click()
  await expect
    .poll(() =>
      page
        .locator('[data-row-count]')
        .getAttribute('data-row-count')
        .then(Number),
    )
    .toBeGreaterThan(84)
  await expect
    .poll(() =>
      page
        .locator('[data-message-id="m20"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBe(64)
})

test('wheel input cancels a pending seek and session changes discard it', async ({
  page,
}) => {
  await page.clock.install()
  await page.getByRole('button', { name: 'Seek delayed' }).click()
  await page.mouse.move(500, 350)
  await page.mouse.wheel(0, -500)
  await page.getByRole('button', { name: 'Switch session' }).click()
  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBe(0)
  await page.clock.fastForward(4500)
  await expect(page.locator('[data-row-count]')).toHaveAttribute(
    'data-row-count',
    '140',
  )
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0)
})

test('editing retains focus and position while streamed rows arrive', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Seek 20', exact: true }).click()
  await expect(page.locator('[data-message-id="m20"]')).toBeVisible()
  await page.getByRole('button', { name: 'Edit off' }).click()
  await page.getByRole('button', { name: 'Stream off' }).click()
  const editor = page.getByLabel('Edit message')
  await editor.fill('Kept draft')
  await expect
    .poll(() =>
      page
        .locator('[data-row-count]')
        .getAttribute('data-row-count')
        .then(Number),
    )
    .toBeGreaterThan(84)
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('Kept draft')
  await expect
    .poll(() =>
      page
        .locator('[data-message-id="m20"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBe(64)
})

test('bottom navigation follows streaming and accounts for dock growth', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Stream off' }).click()
  await page.getByRole('button', { name: 'Bottom', exact: true }).click()
  await page.getByRole('button', { name: 'Resize dock' }).click()
  await expect
    .poll(() =>
      page
        .locator('[data-row-count]')
        .getAttribute('data-row-count')
        .then(Number),
    )
    .toBeGreaterThan(88)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollHeight -
          window.scrollY -
          window.innerHeight,
      ),
    )
    .toBeLessThan(200)
})
