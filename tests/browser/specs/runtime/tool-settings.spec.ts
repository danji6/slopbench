import { expect, test } from '@playwright/test'

const labels = [
  'Ask questions',
  'Read attachments',
  'Process attachments',
  'Delegate tasks',
  'Web fetch',
  'Web search',
  'Read files',
  'Edit files',
  'Shell',
  'Todo list',
  'MCP access',
  'Skills',
]

test('approval settings are visible and editable in the Approvals tab', async ({
  page,
}) => {
  await page.goto('/?fixture=tool-settings')
  const approvals = page.getByRole('tab', { name: 'Approvals', exact: true })
  await approvals.click()
  const panel = page.getByRole('tabpanel', { name: 'Approvals', exact: true })
  await expect(panel).toBeVisible()
  await panel.getByRole('checkbox', { name: 'write_file', exact: true }).check()
  await panel
    .getByRole('textbox', { name: 'Command prefix', exact: true })
    .fill('bun test')
  await panel
    .getByRole('button', { name: 'Add command prefix', exact: true })
    .click()
  await expect(
    panel.getByRole('textbox', { name: 'Path', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Tools', exact: true }).click()
  await approvals.click()
  await expect(
    panel.getByRole('checkbox', { name: 'write_file', exact: true }),
  ).toBeChecked()
  await panel
    .getByRole('button', { name: 'Remove bun test', exact: true })
    .click()
  await expect(
    panel.getByRole('button', { name: 'Remove bun test', exact: true }),
  ).toHaveCount(0)
})

test('readable capability labels and master selection persist independently of external MCP tools', async ({
  page,
}) => {
  await page.goto('/?fixture=tool-settings')
  for (const label of labels)
    await expect(
      page.getByRole('checkbox', { name: label, exact: true }),
    ).not.toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: 'write_file', exact: true }),
  ).toHaveCount(0)
  const all = page.getByRole('checkbox', {
    name: 'All built-in tools',
    exact: true,
  })
  await all.click()
  for (const label of labels)
    await expect(
      page.getByRole('checkbox', { name: label, exact: true }),
    ).toBeChecked()
  await expect(page.getByLabel('Saved selection')).toContainText('"plan"')
  await page.getByRole('tab', { name: 'MCP', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Docs lookup', exact: true }).click()
  await page.getByRole('tab', { name: 'Tools', exact: true }).click()
  await all.click()
  await expect(page.getByLabel('Saved selection')).toHaveText('["docs_lookup"]')
  for (const label of labels)
    await expect(
      page.getByRole('checkbox', { name: label, exact: true }),
    ).not.toBeChecked()
  await page
    .getByRole('checkbox', { name: 'MCP & Skills', exact: true })
    .click()
  await expect(
    page.getByRole('checkbox', { name: 'MCP access', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: 'Skills', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: 'Shell', exact: true }),
  ).not.toBeChecked()
  await page.getByRole('button', { name: 'Save selection' }).click()
  await page.reload()
  await expect(
    page.getByRole('checkbox', { name: 'MCP access', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: 'Skills', exact: true }),
  ).toBeChecked()
  await expect(page.getByLabel('Saved selection')).toHaveText(
    '["mcp_access","skills","docs_lookup"]',
  )
})

test('file editing and shell are grouped without selecting read access', async ({
  page,
}) => {
  await page.goto('/?fixture=tool-settings')
  await page.getByRole('checkbox', { name: 'Edit files', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(
    page.getByRole('checkbox', { name: 'Edit files', exact: true }),
  ).toBeChecked()
  await page.getByRole('checkbox', { name: 'Shell', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Read files', exact: true }),
  ).not.toBeChecked()
  await expect(page.getByLabel('Saved selection')).toHaveText(
    '["edit_files","shell"]',
  )
  await page.getByRole('checkbox', { name: 'Workspace', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Read files', exact: true }),
  ).toBeChecked()
  await page.getByRole('checkbox', { name: 'Workspace', exact: true }).click()
  await expect(page.getByLabel('Saved selection')).toHaveText('[]')
})

test('the master checkbox preserves saved external choices absent from discovery', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'tool-settings-fixture',
      JSON.stringify(['offline_lookup', 'mcp_server:offline']),
    ),
  )
  await page.goto('/?fixture=tool-settings')
  const all = page.getByRole('checkbox', {
    name: 'All built-in tools',
    exact: true,
  })
  await all.click()
  await expect(all).toBeChecked()
  await all.click()
  await expect(page.getByLabel('Saved selection')).toHaveText(
    '["offline_lookup","mcp_server:offline"]',
  )
})

test('attachment processing is an independent opt-in', async ({ page }) => {
  await page.goto('/?fixture=tool-settings')
  const processing = page.getByRole('checkbox', {
    name: 'Process attachments',
    exact: true,
  })
  await expect(processing).not.toBeChecked()
  await processing.click()
  await expect(page.getByLabel('Saved selection')).toHaveText(
    '["process_attachments"]',
  )
  await expect(
    page.getByRole('checkbox', { name: 'Read attachments', exact: true }),
  ).not.toBeChecked()
  await page.getByRole('button', { name: 'Save selection' }).click()
  await page.reload()
  await expect(processing).toBeChecked()
})
