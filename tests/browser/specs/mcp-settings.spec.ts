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

test('tool discovery help opens independently of the labeled switch', async ({
  page,
}) => {
  const toggle = page.getByRole('switch', {
    name: 'Exclude tools from context',
  })
  const help = page.getByRole('button', {
    name: 'About Exclude tools from context',
  })
  await expect(toggle).not.toBeChecked()
  await help.click()
  await expect(page.getByText(/This keeps its starting context/)).toBeVisible()
  await expect(page.getByText(/When off, you select individual/)).toBeVisible()
  await expect(toggle).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByText(/This keeps its starting context/)).toBeHidden()
  await page.getByText('Exclude tools from context', { exact: true }).click()
  await expect(toggle).toBeChecked()
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
})

test('compact settings share label styling and align controls at both widths', async ({
  page,
}) => {
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const layout = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll('[data-slot="settings-field"]'),
      ]
      const firstLabel = rows[0]!.querySelector('label')!
      const switchLabel = rows[3]!.querySelector('label')!
      const help = rows[3]!.querySelector('button')!
      const input = rows[0]!.querySelector('input')!
      const toggle = rows[3]!.querySelector('[role="switch"]')!
      return {
        labelStyles: [firstLabel, switchLabel].map((label) => {
          const style = getComputedStyle(label)
          return [style.fontSize, style.fontWeight, style.color]
        }),
        labelStarts: [firstLabel, switchLabel].map(
          (label) => label.getBoundingClientRect().left,
        ),
        helpGap:
          help.getBoundingClientRect().left -
          switchLabel.getBoundingClientRect().right,
        controlEnds: [input, toggle].map(
          (control) => control.getBoundingClientRect().right,
        ),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }
    })
    expect(layout.labelStyles[0]).toEqual(layout.labelStyles[1])
    expect(layout.labelStarts[0]).toBe(layout.labelStarts[1])
    expect(layout.helpGap).toBeGreaterThanOrEqual(0)
    expect(layout.helpGap).toBeLessThanOrEqual(8)
    expect(layout.controlEnds[0]).toBe(layout.controlEnds[1])
    expect(layout.overflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `/tmp/slopbench-mcp-settings-${width}.png` })
    await page
      .getByRole('button', { name: 'About Exclude tools from context' })
      .click()
    const popover = page.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible()
    await expect(popover).toHaveCSS('opacity', '1')
    const bounds = await popover.boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(384)
    expect(bounds!.width).toBeLessThanOrEqual(width - 32)
    await page.screenshot({ path: `/tmp/slopbench-mcp-help-${width}.png` })
    await page.keyboard.press('Escape')
  }
})
