import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=ui-layout')
})

for (const variant of ['hug', 'pill']) {
  test(`sub-tab indicator is visible on opening settings and follows selection (${variant})`, async ({
    page,
  }) => {
    await page.goto(`/?fixture=ui-layout&variant=${variant}`)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const list = page.getByRole('tablist', { name: 'Tool settings' })
    const indicator = list.getByRole('presentation')
    const selectedTab = list.locator('[aria-selected="true"]')
    const expectIndicator = async () => {
      await expect(indicator).toBeVisible()
      await expect
        .poll(async () => {
          const marker = await indicator.boundingBox()
          const tab = await selectedTab.boundingBox()
          if (!marker || !tab) return false
          return (
            marker.height >= 2 &&
            Math.abs(marker.x - tab.x) < 2 &&
            Math.abs(marker.width - tab.width) < 2
          )
        })
        .toBe(true)
    }
    await expectIndicator()
    await page.getByRole('tab', { name: 'MCP', exact: true }).click()
    await expectIndicator()
    await page.setViewportSize({ width: 850, height: 720 })
    await expectIndicator()
    await page.getByRole('tab', { name: 'Tools', exact: true }).click()
    await expectIndicator()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expectIndicator()
  })
}

test('settings chevron path is vertically centered', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Expand Change password' })
  const offset = await trigger.locator('svg').evaluate((svg) => {
    const path = svg.querySelector('path')!.getBBox()
    return Math.abs(path.y + path.height / 2 - 12)
  })
  expect(offset).toBeLessThan(0.1)
})

for (const streaming of [false, true]) {
  test(`opening a thinking block near the bottom reveals its start (streaming=${streaming})`, async ({
    page,
  }) => {
    if (streaming)
      await page.getByRole('button', { name: 'Stream off' }).click()
    const trigger = page.getByRole('button', { name: 'Thinking' })
    await trigger.click()
    await expect
      .poll(async () => {
        const box = await trigger.boundingBox()
        return Math.abs((box?.y ?? -1) - 64)
      })
      .toBeLessThan(2)
    if (!streaming) return
    await expect(
      page.getByText('Reasoning line 30', { exact: true }),
    ).toBeAttached()
    expect(Math.abs((await trigger.boundingBox())!.y - 64)).toBeLessThan(2)
  })
}

test('wheel input cancels revealing a streaming block', async ({ page }) => {
  await page.getByRole('button', { name: 'Stream off' }).click()
  const trigger = page.getByRole('button', { name: 'Thinking' })
  await trigger.click()
  await page.mouse.move(400, 300)
  await page.mouse.wheel(0, -100)
  await expect(
    page.getByText('Reasoning line 60', { exact: true }),
  ).toBeAttached()
  expect((await trigger.boundingBox())!.y).toBeGreaterThan(300)
})
