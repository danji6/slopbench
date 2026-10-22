import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('mixed MCP content renders literally, reports errors, and never fetches resource links', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('never-fetch.invalid'))
      requests.push(request.url())
  })
  await page.goto('/?fixture=mcp-protocol')
  await expect(page.getByRole('alert')).toContainText(
    'MCP server reported a tool error',
  )
  await expect(
    page.getByText('<script>window.fixtureInjected = true</script> λ😀', {
      exact: true,
    }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fixtureInjected?: boolean }).fixtureInjected,
    ),
  ).toBeUndefined()
  await expect(
    page.getByRole('img', { name: 'Image returned by MCP server' }),
  ).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(
    page.getByText('Embedded resource output', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Unsupported content type: future-block. Preserved as an artifact.',
    ),
  ).toBeVisible()
  const download = page.getByRole('button', {
    name: 'Download MCP result (JSON)',
  })
  const event = page.waitForEvent('download')
  await download.click()
  const artifact = await event
  const path = await artifact.path()
  const fullResult = JSON.parse(await readFile(path!, 'utf8'))
  expect(fullResult.result.structuredContent).toEqual({ finding: 42 })
  expect(fullResult.result.content.at(-1)).toEqual({
    type: 'future-block',
    payload: 'Preserved unknown format',
  })
  expect(requests).toEqual([])
  await page.screenshot({
    path: '/tmp/slopbench-stage4-mcp-content.png',
    fullPage: true,
  })
})

test('protocol discovery is explicit, paginated, and prompt insertion requires a separate click', async ({
  page,
}) => {
  await page.goto('/?fixture=mcp-protocol')
  await expect(
    page.getByRole('status', { name: 'Protocol requests' }),
  ).toHaveText('[]')
  await page.getByRole('button', { name: 'Check server' }).click()
  await expect(page.getByText('30 entries. Page 1.')).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Message composer' }),
  ).toHaveValue('')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('30 entries. Page 2.')).toBeVisible()
  await page
    .getByRole('button', { name: 'Select', exact: true })
    .first()
    .click()
  await expect(page.getByRole('textbox', { name: 'Prompt name' })).toHaveValue(
    'prompt-25',
  )
  await page.getByRole('button', { name: 'Check server' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Message composer' }),
  ).toHaveValue('')
  await page.getByRole('button', { name: 'Insert prompt into message' }).click()
  expect(
    await page.getByRole('textbox', { name: 'Message composer' }).inputValue(),
  ).toContain('Analyze {{ literal }}')
})

test('resource templates select an explicit URI read without fetching links', async ({
  page,
}) => {
  await page.goto('/?fixture=mcp-protocol')
  await page.getByRole('combobox', { name: 'MCP protocol operation' }).click()
  await page
    .getByRole('option', { name: 'List resource templates', exact: true })
    .click()
  await page.getByRole('button', { name: 'Check server' }).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Resource URI' })
    .fill('fixture://target/42')
  await page.getByRole('button', { name: 'Check server' }).click()
  await expect(
    page.getByText('Requested resource output', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('status', { name: 'Protocol requests' }),
  ).toContainText('fixture://target/42')
})
