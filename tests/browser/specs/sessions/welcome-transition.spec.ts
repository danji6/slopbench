import { expect, test } from '@playwright/test'

test('switching welcome views does not hide a focused control from accessibility', async ({
  page,
}) => {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Blocked aria-hidden'))
      warnings.push(message.text())
  })
  await page.goto('/?fixture=empty-chat')
  const switchAgent = page.getByRole('button', {
    name: 'Choose another agent',
  })
  await switchAgent.focus()
  await expect(switchAgent).toBeFocused()
  await page.locator('main').ariaSnapshot()
  await switchAgent.press('Enter')
  await page.locator('main').ariaSnapshot()
  await expect(
    page.getByRole('textbox', { name: 'Search agents' }),
  ).toBeVisible()
  expect(warnings).toEqual([])
})

for (const prompts of [false, true]) {
  test(`agent selection waits for the complete ${prompts ? 'configured' : 'fallback'} welcome`, async ({
    page,
  }) => {
    const flags = prompts ? '&prompts' : ''
    await page.goto(
      `/?fixture=empty-chat&noAgent&deferAgentDetails&deferAgentPrompts${flags}`,
    )
    const chooser = page.getByRole('region', {
      name: 'Choose an agent',
      includeHidden: true,
    })
    const switchAgent = page.getByRole('button', {
      name: 'Choose another agent',
    })
    await page.getByRole('button', { name: /^Agent 3 / }).click()
    const toolbar = page.getByRole('combobox', { name: 'Select agent' })
    await expect(toolbar).toContainText('Agent 3')
    await expect(chooser).toBeVisible()
    await expect(
      chooser.locator('xpath=ancestor::*[@aria-busy="true"]'),
    ).toHaveCount(1)
    await expect(switchAgent).toHaveCount(0)
    await expect(chooser.locator('xpath=ancestor::*[@inert]')).toHaveCount(1)

    await page.evaluate(() =>
      window.dispatchEvent(new Event('resolve-agent-details')),
    )
    await expect(page.getByLabel('Loading welcome')).toHaveCount(0)
    await expect(chooser).toBeVisible()
    await expect(switchAgent).toHaveCount(0)

    await page.evaluate(() =>
      window.dispatchEvent(new Event('resolve-agent-prompts')),
    )
    const welcome = prompts
      ? page.getByText('I am your configured welcome prompt.')
      : page.getByRole('heading', { name: 'What’s on your mind?' })
    await expect(welcome).toBeVisible()
    await expect(switchAgent).toBeVisible()
    await expect(chooser).toHaveCount(0)
    await switchAgent.click()
    await expect(chooser).toBeVisible()
  })
}
