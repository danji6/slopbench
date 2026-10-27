import { expect, test } from '@playwright/test'

const labels = [
  'Ask questions',
  'Read attachments',
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

test('readable capability labels and master selection persist independently of external MCP tools', async ({
  page,
}) => {
  await page.goto('/?fixture=tool-settings')
  for (const label of labels)
    await expect(
      page.getByRole('checkbox', { name: label, exact: true }),
    ).not.toBeChecked()
  await expect(
    page.getByText(
      'Existing chats use their saved tools until you reset the chat cache.',
    ),
  ).toBeVisible()
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
