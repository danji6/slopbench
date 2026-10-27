import { expect, test } from '@playwright/test'
import {
  catalogDefinitions,
  longDescription,
} from '~/tests/browser/mcp-catalog-data'

test.beforeEach(async ({ page }) => {
  await page.route('**/mcp-definitions/*.json', async (route) => {
    const index = Number(
      route
        .request()
        .url()
        .match(/opaque-(\d+)\.json/)?.[1],
    )
    await route.fulfill({ json: catalogDefinitions[index] })
  })
  await page.goto('/?fixture=mcp-catalog')
})

test('catalog browsing reaches tools beyond 100 and edits their independent policies', async ({
  page,
}) => {
  await expect(
    page.getByRole('button', { name: 'Previous', exact: true }),
  ).toBeDisabled()
  for (let i = 0; i < 6; i++)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /^tool_120 / }).click()
  const download = page.getByRole('link', {
    name: 'Download tool definition (JSON)',
    exact: true,
  })
  const panel = page
    .locator('[data-slot="accordion-content"]')
    .filter({ has: download })
  await expect(panel).toHaveCSS('filter', 'blur(0px)')
  await expect(download).toBeVisible()
  const textarea = page.locator('textarea')
  await expect(textarea).toHaveValue(longDescription)
  await expect(page.getByText(/Description preview/)).toHaveCount(0)
  const descriptionBounds = await textarea.boundingBox()
  const downloadBounds = await download.boundingBox()
  expect(downloadBounds!.y).toBeGreaterThanOrEqual(
    descriptionBounds!.y + descriptionBounds!.height,
  )
  expect(downloadBounds!.x).toBe(descriptionBounds!.x)
  await download.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/slopbench-mcp-description.png' })
  await page.getByRole('switch', { name: 'Enabled', exact: true }).click()
  await expect(page.getByLabel('Catalog policy')).toContainText(
    '"enabled":false',
  )
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  if (
    (await page
      .getByRole('button', { name: /^tool_120 / })
      .getAttribute('aria-expanded')) === 'false'
  ) {
    await page.getByRole('button', { name: /^tool_120 / }).click()
  }
  await expect(
    page.getByRole('switch', { name: 'Enabled', exact: true }),
  ).not.toBeChecked()
})

test('a failed refresh leaves the previous catalog usable and visible', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Simulate failed refresh', exact: true })
    .click()
  await expect(
    page.getByText('Refresh failed: Continuation page failed'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^tool_000 / })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('button', { name: /^tool_020 / })).toBeVisible()
})

test('editing and resetting restores the complete original, without saving loaded metadata', async ({
  page,
}) => {
  for (let i = 0; i < 6; i++)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /^tool_120 / }).click()
  const editor = page.getByRole('textbox', { name: 'Tool description:' })
  await expect(editor).toHaveValue(longDescription)
  await expect(page.getByLabel('Catalog policy')).not.toContainText(
    'Full description retrieval',
  )
  await editor.fill('My custom description')
  await page.getByRole('button', { name: /^tool_120 / }).click()
  await expect(editor).toBeHidden()
  await page.getByRole('button', { name: /^tool_120 / }).click()
  await expect(editor).toBeEnabled()
  await expect(editor).toHaveValue('My custom description')
  await page
    .getByRole('button', { name: 'Reset tool description to original' })
    .click()
  await expect(editor).toHaveValue(longDescription)
  await expect(page.getByLabel('Catalog policy')).not.toContainText(
    'descriptionOverride',
  )
  await expect(page.getByLabel('Catalog policy')).not.toContainText(
    'Full description retrieval',
  )
})

test('collapsed tools do not load definitions and policy edits do not reload them', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/mcp-definitions/'))
      requests.push(request.url())
  })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  expect(requests).toEqual([])
  await page.getByRole('button', { name: /^tool_000 / }).click()
  await expect(
    page.getByRole('textbox', { name: 'Tool description:' }),
  ).toHaveValue('Catalog tool 0')
  await expect(
    page.getByRole('link', { name: 'Download tool definition (JSON)' }),
  ).toBeVisible()
  await page.getByRole('switch', { name: 'Enabled', exact: true }).click()
  expect(requests).toHaveLength(1)
  expect(requests[0]).toContain('/opaque-0.json')
})

test('a failed definition cannot be edited as a preview and can be retried', async ({
  page,
}) => {
  let attempt = 0
  await page.route('**/mcp-definitions/opaque-0.json', async (route) => {
    attempt++
    if (attempt === 1) await route.fulfill({ status: 503 })
    else await route.fulfill({ json: catalogDefinitions[0] })
  })
  await page.getByRole('button', { name: /^tool_000 / }).click()
  const editor = page.getByRole('textbox', { name: 'Tool description:' })
  await expect(page.getByRole('alert')).toHaveText(
    'Could not load the full tool description.',
  )
  await expect(editor).toBeDisabled()
  await expect(editor).toHaveValue('')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(editor).toBeEnabled()
  await expect(editor).toHaveValue('Catalog tool 0')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(attempt).toBe(2)
})

test('changing pages detaches a pending description without applying its late result', async ({
  page,
}) => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  await page.route('**/mcp-definitions/opaque-0.json', async (route) => {
    await pending
    await route.fulfill({ json: catalogDefinitions[0] }).catch(() => {})
  })
  await page.getByRole('button', { name: /^tool_000 / }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading full description…' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Tool description:' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /^tool_020 / }).click()
  const editor = page.getByRole('textbox', { name: 'Tool description:' })
  await expect(editor).toHaveValue('Catalog tool 20')
  finish()
  await expect(editor).toHaveValue('Catalog tool 20')
  await expect(page.getByLabel('Catalog policy')).not.toContainText(
    'descriptionOverride',
  )
})
