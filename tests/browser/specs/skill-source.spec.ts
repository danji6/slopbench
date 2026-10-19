import { expect, test } from '@playwright/test'

test('project sources default to skill discovery and unrelated pickers hide the option', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/?fixture=skill-source')
  await page.getByRole('button', { name: 'Add source' }).click()
  const toggle = page.getByRole('checkbox', { name: 'Allow .agents/skills' })
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await expect(page.locator('output')).toHaveText(
    '{"root":"/projects","discoverSkills":false}',
  )
  await page.getByRole('button', { name: 'Add source' }).click()
  await expect(toggle).toBeChecked()
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await expect(page.locator('output')).toHaveText(
    '{"root":"/projects","discoverSkills":true}',
  )
  await page.getByRole('button', { name: 'Choose agent home' }).click()
  await expect(toggle).toHaveCount(0)
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await expect(page.locator('output')).toHaveText('{"root":"/projects"}')
})
