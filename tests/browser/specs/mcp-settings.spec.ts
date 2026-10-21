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

test('startup, inactivity and absolute deadlines are independently editable', async ({
  page,
}) => {
  await page
    .getByRole('textbox', { name: 'MCP command', exact: true })
    .fill('node')
  await page
    .getByRole('spinbutton', { name: 'MCP startup timeout', exact: true })
    .fill('45000')
  await page
    .getByRole('spinbutton', { name: 'MCP inactivity timeout', exact: true })
    .fill('600000')
  await page
    .getByRole('spinbutton', { name: 'MCP absolute timeout', exact: true })
    .fill('1800000')
  await page.getByRole('button', { name: 'Validate connection' }).click()
  await expect(page.getByLabel('Connection result')).toContainText(
    '"startupTimeoutMs":45000',
  )
  await expect(page.getByLabel('Connection result')).toContainText(
    '"requestTimeoutMs":600000',
  )
  await expect(page.getByLabel('Connection result')).toContainText(
    '"maxTotalTimeoutMs":1800000',
  )
})

test('each timeout can be reset independently to its default', async ({
  page,
}) => {
  await page
    .getByRole('textbox', { name: 'MCP command', exact: true })
    .fill('node')
  const timeouts = [
    { label: 'MCP startup timeout', defaultValue: '30000' },
    { label: 'MCP inactivity timeout', defaultValue: '300000' },
    { label: 'MCP absolute timeout', defaultValue: '1800000' },
  ]
  for (const { label } of timeouts) {
    await page
      .getByRole('spinbutton', { name: label, exact: true })
      .fill('90000')
  }
  for (const [index, { label, defaultValue }] of timeouts.entries()) {
    const reset = page.getByRole('button', {
      name: `Reset ${label} to default`,
    })
    await reset.click()
    await expect(
      page.getByRole('spinbutton', { name: label, exact: true }),
    ).toHaveValue(defaultValue)
    await expect(reset).toBeDisabled()
    for (const pending of timeouts.slice(index + 1)) {
      await expect(
        page.getByRole('spinbutton', { name: pending.label, exact: true }),
      ).toHaveValue('90000')
    }
  }
  await page.getByRole('button', { name: 'Validate connection' }).click()
  const output = page.getByLabel('Connection result')
  await expect(output).toContainText('"startupTimeoutMs":30000')
  await expect(output).toContainText('"requestTimeoutMs":300000')
  await expect(output).toContainText('"maxTotalTimeoutMs":1800000')
})

test('progress without a total never invents a percentage', async ({
  page,
}) => {
  const status = page.getByRole('status').filter({ hasText: 'Analyzing' })
  await expect(status).toHaveText('Analyzing · 3')
  await expect(status).not.toContainText('%')
  await page.getByRole('button', { name: 'Toggle progress total' }).click()
  await expect(status).toHaveText('Analyzing · 3 / 10')
})
