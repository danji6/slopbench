import { expect, test } from '@playwright/test'

test('directory pickers omit skill discovery controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/?fixture=skill-source')
  await page.getByRole('button', { name: 'Add source' }).click()
  const toggle = page.getByRole('checkbox', { name: 'Allow .agents/skills' })
  await expect(toggle).toHaveCount(0)
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await expect(page.locator('output')).toHaveText('{"root":"/projects"}')
  await page.getByRole('button', { name: 'Choose agent home' }).click()
  await expect(toggle).toHaveCount(0)
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await expect(page.locator('output')).toHaveText('{"root":"/projects"}')
})
