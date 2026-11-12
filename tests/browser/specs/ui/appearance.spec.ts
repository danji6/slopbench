import { expect, test } from '@playwright/test'

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
