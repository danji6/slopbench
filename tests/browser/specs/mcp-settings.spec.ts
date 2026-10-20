import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=mcp-settings')
})

test('local argv and environment are edited without shell parsing', async ({
  page,
}) => {
  await page
    .getByRole('textbox', { name: 'MCP command', exact: true })
    .fill('npx')
  await page
    .getByRole('textbox', { name: 'MCP arguments', exact: true })
    .fill('["-y","toolkit@1.0.0","$(touch should-not-run)"]')
  await page
    .getByRole('textbox', { name: 'MCP environment', exact: true })
    .fill('{"MODE":"analysis"}')
  await page.getByRole('button', { name: 'Validate connection' }).click()
  await expect(page.getByLabel('Connection result')).toContainText(
    '$(touch should-not-run)',
  )
  await expect(page.getByLabel('Connection result')).toContainText(
    '"MODE":"analysis"',
  )
})

test('invalid argv and missing commands produce validation errors', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Validate connection' }).click()
  await expect(page.getByLabel('Connection result')).toContainText(
    'local command is required',
  )
  await page
    .getByRole('textbox', { name: 'MCP command', exact: true })
    .fill('node')
  await page
    .getByRole('textbox', { name: 'MCP arguments', exact: true })
    .fill('{"wrong":true}')
  await page.getByRole('button', { name: 'Validate connection' }).click()
  await expect(page.getByLabel('Connection result')).toContainText(
    'JSON array of strings',
  )
})

test('secret values are masked and excluded from the saved preview', async ({
  page,
}) => {
  await page
    .getByRole('textbox', { name: 'MCP command', exact: true })
    .fill('node')
  const secrets = page.getByLabel('MCP secret environment', { exact: true })
  await expect(secrets).toHaveAttribute('type', 'password')
  await secrets.fill('{"TOKEN":"private-fixture-value"}')
  await page.getByRole('button', { name: 'Validate connection' }).click()
  await expect(page.getByLabel('Connection result')).toContainText('TOKEN')
  await expect(page.getByLabel('Connection result')).not.toContainText(
    'private-fixture-value',
  )
})
