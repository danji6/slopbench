import { expect, test } from '@playwright/test'

test('keeps the current theme while a switched session loads its agent', async ({
  page,
}) => {
  await page.goto(
    '/?fixture=empty-chat&shellTheme&deferAgentDetails&id=agent-0',
  )
  const root = page.locator('html')
  const currentSession = page.getByRole('status', { name: 'Current session' })
  await expect(root).toHaveCSS('--source-color', '#176b46')
  await page.evaluate(() => {
    const root = document.documentElement
    window.addEventListener('stylechange', () => {
      const source = getComputedStyle(root).getPropertyValue('--source-color')
      root.dataset.themeHistory = `${root.dataset.themeHistory ?? ''} ${source}`
    })
  })

  await page.getByRole('link', { name: 'Switch to themed agent' }).click()
  await expect(currentSession).toHaveText('agent-1')
  await expect(root).toHaveCSS('--source-color', '#176b46')
  await page.getByRole('button', { name: 'Resolve agent details' }).click()
  await expect(root).toHaveCSS('--source-color', '#ad2740')
  await expect(root).not.toHaveAttribute('data-theme-history', /#274cad/)

  await page.getByRole('link', { name: 'Switch to unthemed agent' }).click()
  await expect(currentSession).toHaveText('agent-2')
  await expect(root).toHaveCSS('--source-color', '#274cad')
})

test('explicit theme modes override the system in the preview and after applying', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/?fixture=appearance')

  const root = page.locator('html')
  const preview = page.getByRole('form', { name: 'Appearance preview' })
  const mode = page
    .locator('[data-slot="settings-list-item"]')
    .filter({ hasText: 'Theme mode' })
    .getByRole('combobox')
  const apply = page.getByRole('button', { name: 'Apply theme' })

  await expect(root).toHaveCSS('color-scheme', 'dark')
  await mode.click()
  await page.getByRole('option', { name: 'Light', exact: true }).click()
  await expect(preview).toHaveCSS('color-scheme', 'light')
  await expect(root).toHaveCSS('color-scheme', 'dark')
  await apply.click()
  await expect(root).toHaveCSS('color-scheme', 'light')

  await page.emulateMedia({ colorScheme: 'light' })
  await mode.click()
  await page.getByRole('option', { name: 'Dark', exact: true }).click()
  await expect(preview).toHaveCSS('color-scheme', 'dark')
  await expect(root).toHaveCSS('color-scheme', 'light')
  await apply.click()
  await expect(root).toHaveCSS('color-scheme', 'dark')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(root).toHaveCSS('color-scheme', 'dark')
  await expect(preview).toHaveCSS('color-scheme', 'dark')

  await mode.click()
  await page.getByRole('option', { name: 'System', exact: true }).click()
  await expect(preview).toHaveCSS('color-scheme', 'light')
  await apply.click()
  await expect(root).toHaveCSS('color-scheme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(root).toHaveCSS('color-scheme', 'dark')
  await expect(preview).toHaveCSS('color-scheme', 'dark')
})
