import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=skills')
  await page.getByRole('button', { name: 'Skill library', exact: true }).click()
})

test('checks the whole library despite search, confirms missing names and supports cancel', async ({
  page,
}) => {
  const search = page.getByRole('searchbox', { name: 'Search skill names' })
  const check = page.getByRole('button', {
    name: 'Check installed skills',
    exact: true,
  })
  await search.fill('skill-01')
  const searchBox = await search.boundingBox()
  const checkBox = await check.boundingBox()
  expect(checkBox!.y).toBeGreaterThan(searchBox!.y + searchBox!.height)
  await check.click()
  await expect(
    page.getByRole('button', { name: 'Checking skills…', exact: true }),
  ).toBeDisabled()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('skill-00')
  await expect(dialog).toContainText('skill-84')
  await expect(dialog).toContainText('surviving files')
  await page.setViewportSize({ width: 375, height: 812 })
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true)
  await page.screenshot({ path: '/tmp/slopbench-skill-verification.png' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Checked 85 skills.' }),
  ).toContainText('2 skills have missing data')
  await search.fill('skill-00')
  await expect(
    page.getByRole('listitem').filter({ hasText: 'skill-00' }),
  ).toBeVisible()
  await check.click()
  await dialog
    .getByRole('button', { name: 'Remove missing skills', exact: true })
    .click()
  await expect(
    page.getByText(
      'Removed 2 missing skills. 0 entries were retained after rechecking.',
    ),
  ).toBeVisible()
  await expect(
    page.getByText('No skills found.', { exact: true }),
  ).toBeVisible()
  await search.fill('skill-84')
  await expect(
    page.getByText('No skills found.', { exact: true }),
  ).toBeVisible()
  await search.fill('skill-01')
  await expect(
    page.getByRole('listitem').filter({ hasText: 'skill-01' }),
  ).toBeVisible()
  await check.click()
  await expect(
    page.getByText('Checked 83 skills. All checked skills are available.'),
  ).toBeVisible()
  await expect(dialog).toHaveCount(0)
})

test('failed checks show an error without offering deletion and can be retried', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Fail next skill check', exact: true })
    .click()
  const check = page.getByRole('button', {
    name: 'Check installed skills',
    exact: true,
  })
  await check.click()
  await expect(page.getByRole('alert')).toContainText('Sidecar unavailable')
  await expect(
    page.getByText('The check could not finish. No skills were removed.'),
  ).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Restore skill data', exact: true })
    .click()
  await check.click()
  await expect(
    page.getByText('Checked 85 skills. All checked skills are available.'),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})
