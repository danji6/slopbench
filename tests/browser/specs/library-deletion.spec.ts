import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=skills')
})

async function openDeletion(page: Page) {
  await page.getByRole('button', { name: 'Skill library', exact: true }).click()
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByText('skill-00', { exact: true }) })
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  return page.getByRole('alertdialog')
}

test('confirmation shows affected agents, cancels safely, and keeps usable agent copies', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Share fixture folder', exact: true })
    .click()
  const toggle = page.getByRole('switch', {
    name: 'Enable skill-00',
    exact: true,
  })
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  const dialog = await openDeletion(page)
  await expect(dialog).toContainText('Affected agents:')
  await expect(dialog).toContainText('Fixture, Other')
  await expect(dialog).not.toContainText('/fixture/managed-home')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('skill-00', { exact: true })).toBeVisible()
  await openDeletion(page)
  await dialog.getByRole('button', { name: 'Keep copies', exact: true }).click()
  await expect(page.getByText('Updating files…')).toHaveCount(0, {
    timeout: 5000,
  })
  await expect(page.getByText('skill-00', { exact: true })).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Agent settings', exact: true })
    .click()
  await expect(page.getByText('Agent copy', { exact: true })).toBeVisible()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await page.getByRole('searchbox').fill('skill-00')
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemradio', { name: 'Added', exact: true }).click()
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByText('skill-00', { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Remove', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(row).toHaveCount(0)
})

test('delete all automatically removes assignments and survives operation failure and retry', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Fail next operation', exact: true })
    .click()
  const dialog = await openDeletion(page)
  await dialog.getByRole('button', { name: 'Delete all', exact: true }).click()
  await expect(
    page.getByText('Fixture operation failed', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('skill-00', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('skill-00', { exact: true })).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Agent settings', exact: true })
    .click()
  await expect(
    page.getByRole('switch', { name: 'Enable skill-00', exact: true }),
  ).toHaveCount(0)
})

test('busy agents reactively block both choices and deletion dialog fits narrow screens', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Toggle busy agent', exact: true })
    .click()
  const dialog = await openDeletion(page)
  await expect(dialog.getByRole('alert')).toContainText('Fixture')
  for (const name of ['Delete all', 'Keep copies'])
    await expect(
      dialog.getByRole('button', { name, exact: true }),
    ).toBeDisabled()
  for (const width of [760, 320, 220]) {
    await page.setViewportSize({ width, height: 700 })
    await expect
      .poll(() =>
        dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true)
    await expect
      .poll(() =>
        dialog
          .getByRole('button')
          .evaluateAll((buttons) =>
            buttons.every((node) => node.scrollWidth <= node.clientWidth),
          ),
      )
      .toBe(true)
  }
  await page.evaluate(() =>
    window.dispatchEvent(new Event('skills-fixture-toggle-busy')),
  )
  for (const name of ['Delete all', 'Keep copies'])
    await expect(
      dialog.getByRole('button', { name, exact: true }),
    ).toBeEnabled()
  await page.screenshot({ path: '/tmp/slopbench-library-deletion-dialog.png' })
})
