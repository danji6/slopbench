import { expect, test } from '@playwright/test'

test('agent integration actions handle failed saves and long names without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/?fixture=integrations')
  await page
    .getByLabel('Toolkit directory', { exact: true })
    .fill('/fixture/long-toolkit')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const selection = page.getByRole('region', { name: 'Integration selection' })
  const row = selection.getByRole('listitem')
  const add = row.getByRole('button', { name: 'Add', exact: true })
  const showMore = row.getByRole('button', { name: 'Show more', exact: true })
  await expect(showMore).toBeVisible()
  await showMore.click()
  const showLess = row.getByRole('button', { name: 'Show less', exact: true })
  await expect(showLess).toHaveAttribute('aria-expanded', 'true')
  await page
    .getByRole('button', { name: 'Fail next integration operation' })
    .click()
  await add.click()
  await expect(selection.getByRole('alert')).toHaveText(
    'Fixture operation failed.',
  )
  await expect(add).toBeEnabled()
  await expect(row.getByText('(Added)', { exact: true })).toHaveCount(0)
  await add.click()
  await expect(add).toBeDisabled()
  await expect(selection.getByRole('alert')).toHaveCount(0)
  const remove = row.getByRole('button', { name: 'Remove', exact: true })
  await expect(remove).toBeVisible()
  for (const width of [320, 240, 768]) {
    await page.setViewportSize({ width, height: 900 })
    for (const element of [
      selection,
      row,
      row.locator('p').first(),
      row.locator('p').last(),
    ]) {
      await expect
        .poll(() =>
          element.evaluate((node) => node.scrollWidth <= node.clientWidth),
        )
        .toBe(true)
    }
    const bounds = await selection.boundingBox()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
  }
  await showLess.click()
  await expect(showMore).toHaveAttribute('aria-expanded', 'false')
  await remove.click()
  await expect(add).toBeEnabled()
  await expect(remove).toHaveCount(0)
})

test('skill switches update immediately without disabling cards and roll back failed saves', async ({
  page,
}) => {
  await page.goto('/?fixture=integrations')
  await page
    .getByLabel('Toolkit directory', { exact: true })
    .fill('/fixture/toolkit')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const card = page.getByRole('article', {
    name: 'Fixture Toolkit integration',
  })
  await card.getByRole('button', { name: /Expand Fixture Toolkit/ }).click()
  await card
    .getByRole('button', { name: 'Preview skills', exact: true })
    .click()
  const include = card.getByRole('switch', {
    name: 'Include skills',
    exact: true,
  })
  const review = card.getByRole('switch', { name: 'review', exact: true })
  const complete = page.getByRole('button', {
    name: 'Complete next skill save',
  })
  const refresh = card.getByRole('button', { name: 'Refresh manifest' })
  await page.getByRole('button', { name: 'Hold skill saves' }).click()
  await page
    .getByRole('button', { name: 'Fail next integration operation' })
    .click()
  await review.click()
  await expect(review).not.toBeChecked()
  await expect(review).toBeEnabled()
  await expect(include).toBeEnabled()
  await expect(refresh).toBeEnabled()
  await include.click()
  await expect(include).not.toBeChecked()
  await complete.click()
  await expect(review).toBeChecked()
  await expect(include).not.toBeChecked()
  await expect(card.getByRole('alert')).toHaveText('Fixture operation failed.')
  await complete.click()
  await expect(include).not.toBeChecked()
  await expect(card.getByRole('alert')).toHaveText('Fixture operation failed.')
  await review.click()
  await expect(review).not.toBeChecked()
  await expect(card.getByRole('alert')).toHaveCount(0)
  await complete.click()
  await expect(review).not.toBeChecked()
  await expect(include).not.toBeChecked()
  await expect(card.getByRole('status')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Fail next integration operation' })
    .click()
  await include.click()
  await expect(include).toBeChecked()
  await expect(review).toBeEnabled()
  await complete.click()
  await expect(include).not.toBeChecked()
  await expect(card.getByRole('alert')).toHaveText('Fixture operation failed.')
})

test('linked toolkit activation and searchable agent selection', async ({
  page,
}) => {
  await page.goto('/?fixture=integrations')
  await page
    .getByLabel('Toolkit directory', { exact: true })
    .locator('..')
    .getByRole('button', { name: 'Browse', exact: true })
    .click()
  const picker = page.getByRole('dialog', {
    name: 'Select a toolkit directory',
  })
  await picker.getByRole('option', { name: 'toolkit', exact: true }).click()
  await picker.getByRole('button', { name: 'Use this folder' }).click()
  await expect(picker).toHaveCount(0)
  await expect(
    page.getByLabel('Toolkit directory', { exact: true }),
  ).toHaveValue('/fixture/toolkit')
  await expect(page.getByRole('article')).toHaveCount(0)
  await page
    .getByLabel('Toolkit directory', { exact: true })
    .locator('..')
    .getByRole('button', { name: 'Browse', exact: true })
    .click()
  await expect(picker.getByLabel('Folder path')).toHaveValue('/fixture/toolkit')
  await picker.getByRole('button', { name: 'Up', exact: true }).click()
  await expect(picker.getByLabel('Folder path')).toHaveValue('/fixture')
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByLabel('Toolkit directory', { exact: true }),
  ).toHaveValue('/fixture/toolkit')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const card = page.getByRole('article', {
    name: 'Fixture Toolkit integration',
  })
  await expect(card).toBeVisible()
  const expand = card.getByRole('button', {
    name: /^(Expand|Collapse) Fixture Toolkit$/,
  })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expect(
    card.getByRole('button', { name: 'Refresh manifest' }),
  ).toBeHidden()
  await expand.click()
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toContainText('/fixture/toolkit')
  await expect(
    card.getByRole('switch', { name: 'Available', exact: true }),
  ).toHaveCount(0)
  await card.getByRole('button', { name: 'Preview skills' }).click()
  const skill = card.getByRole('switch', { name: 'review', exact: true })
  await expect(skill).toBeChecked()
  await skill.click()
  await expect(skill).not.toBeChecked()
  await expand.click()
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expand.click()
  await expect(skill).not.toBeChecked()
  await page.getByRole('button', { name: 'Inspect integration events' }).click()
  await expect(page.getByLabel('Integration events')).toContainText(
    '"launches":0',
  )
  const defaults = page
    .getByRole('region', { name: 'Integration selection' })
    .first()
  const toolkit = defaults
    .getByRole('listitem')
    .filter({ hasText: 'Fixture Toolkit' })
  await expect(toolkit).toContainText(
    'Tools and skills for reviewing local evidence.',
  )
  await defaults.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Integration selection' }),
  ).toHaveCount(1)
  const search = defaults.getByRole('searchbox', {
    name: 'Search integrations',
  })
  await search.fill('missing')
  await expect(defaults.getByText('No integrations found.')).toBeVisible()
  await expect(defaults.getByRole('listitem')).toHaveCount(0)
  await search.fill('FIXTURE')
  await expect(
    toolkit.getByRole('button', { name: 'Add', exact: true }),
  ).toBeDisabled()
  await expect(toolkit.getByText('(Added)', { exact: true })).toBeVisible()
  await search.clear()
  await defaults.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(
    toolkit.getByRole('button', { name: 'Add', exact: true }),
  ).toBeEnabled()
  await expect(
    toolkit.getByRole('button', { name: 'Remove', exact: true }),
  ).toHaveCount(0)
  await expect(defaults.getByRole('switch')).toHaveCount(0)
  await expect(
    page.getByText('Accepted manifest', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText('analysis settings', { exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText('undiscovered', { exact: false })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Check connections' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Inspect integration events' }).click()
  await expect(page.getByLabel('Integration events')).toContainText(
    '"launches":0',
  )
  await page.getByRole('button', { name: 'About integrations' }).click()
  const help = page.getByRole('dialog', { name: 'Using integrations' })
  await expect(
    help.getByRole('heading', { name: 'How to integrate a toolkit' }),
  ).toBeVisible()
  await expect(help).toContainText('scripts/fetch.mjs')
  await help.getByRole('button', { name: 'Close', exact: true }).click()
})

test('manifest refresh applies changes immediately and reports them beneath the button', async ({
  page,
}) => {
  await page.goto('/?fixture=integrations')
  await page
    .getByLabel('Toolkit directory', { exact: true })
    .fill('/fixture/toolkit')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const card = page.getByRole('article', {
    name: 'Fixture Toolkit integration',
  })
  await card
    .getByRole('button', { name: /^(Expand|Collapse) Fixture Toolkit$/ })
    .click()
  await expect(page.getByText('Toolkit linked.', { exact: false })).toHaveCount(
    0,
  )
  const refresh = card.getByRole('button', { name: 'Refresh manifest' })
  await refresh.click()
  await expect(refresh.locator('..').getByRole('status')).toHaveText(
    'Manifest refreshed.',
  )
  await page.getByRole('button', { name: 'Change manifest on disk' }).click()
  await page.getByRole('button', { name: 'Observe manifest changes' }).click()
  await expect(refresh.locator('..').getByRole('status')).toHaveText(
    'Manifest changed. Refresh to apply the updated configuration.',
  )
  await expect(card.getByRole('alert')).toHaveCount(0)
  await refresh.click()
  await expect(refresh.locator('..').getByRole('status')).toHaveText(
    'Manifest changed. Updated configuration applied.',
  )
  await expect(
    page.getByRole('button', { name: 'Accept revision' }),
  ).toHaveCount(0)
  await expect(page.getByText('Review manifest changes')).toHaveCount(0)
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  await expect(
    card.getByRole('button', { name: /^(Expand|Collapse) Fixture Toolkit$/ }),
  ).toHaveAttribute('aria-expanded', 'true')
  await refresh.click()
  await expect(refresh.locator('..').getByRole('status')).toHaveText(
    'Manifest refreshed.',
  )
  await page
    .getByRole('button', { name: 'Remove Fixture Toolkit link' })
    .click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(
    page
      .getByRole('region', { name: 'Integrations settings' })
      .getByRole('status'),
  ).toHaveCount(0)
})

test('feedback stays beside its control and inside the affected integration', async ({
  page,
}) => {
  await page.goto('/?fixture=integrations')
  const root = page.getByLabel('Toolkit directory', { exact: true })
  const link = page.getByRole('button', { name: 'Link', exact: true })
  const failNext = page.getByRole('button', {
    name: 'Fail next integration operation',
  })
  await root.fill('/fixture/toolkit')
  await failNext.click()
  await link.click()
  await expect(link.locator('..').getByRole('alert')).toHaveText(
    'Fixture operation failed.',
  )
  await link.click()
  await expect(link.locator('..').getByRole('alert')).toHaveCount(0)
  await expect(
    page
      .getByRole('region', { name: 'Integrations settings' })
      .getByRole('status'),
  ).toHaveCount(0)
  await root.fill('/fixture/other-toolkit')
  await link.click()
  const first = page.getByRole('article', {
    name: 'Fixture Toolkit integration',
  })
  const other = page.getByRole('article', { name: 'Other Toolkit integration' })
  await first
    .getByRole('button', { name: /^(Expand|Collapse) Fixture Toolkit$/ })
    .click()
  await other
    .getByRole('button', { name: /^(Expand|Collapse) Other Toolkit$/ })
    .click()
  const refresh = first.getByRole('button', { name: 'Refresh manifest' })
  await failNext.click()
  await refresh.click()
  await expect(refresh.locator('..').getByRole('alert')).toHaveText(
    'Fixture operation failed.',
  )
  await expect(other.getByRole('alert')).toHaveCount(0)
  await refresh.click()
  await expect(refresh.locator('..').getByRole('alert')).toHaveCount(0)
  await expect(refresh.locator('..').getByRole('status')).toHaveText(
    'Manifest refreshed.',
  )
  await expect(other.getByRole('status')).toHaveCount(0)
  await first
    .getByRole('button', { name: /^(Expand|Collapse) Fixture Toolkit$/ })
    .click()
  const remove = first.getByRole('button', {
    name: 'Remove Fixture Toolkit link',
  })
  await failNext.click()
  await remove.click()
  await expect(remove.locator('..').getByRole('alert')).toHaveText(
    'Fixture operation failed.',
  )
  await expect(
    first.getByRole('button', { name: /^(Expand|Collapse) Fixture Toolkit$/ }),
  ).toHaveAttribute('aria-expanded', 'false')
  await remove.click()
  await expect(first).toHaveCount(0)
  await expect(other).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('integration credential settings save hidden values without launching tools', async ({
  page,
}) => {
  await page.goto('/?fixture=integrations')
  await page
    .getByLabel('Toolkit directory', { exact: true })
    .fill('/fixture/toolkit')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const card = page.getByRole('article', {
    name: 'Fixture Toolkit integration',
  })
  await card
    .getByRole('button', { name: 'Expand Fixture Toolkit', exact: true })
    .click()
  await card.getByRole('button', { name: 'Expand Server settings' }).click()
  await card
    .getByLabel('engine environment variable', { exact: true })
    .fill('TOKEN')
  await card
    .getByLabel('engine credential value', { exact: true })
    .fill('private-credential')
  await card
    .getByRole('button', { name: 'Save credential', exact: true })
    .click()
  await expect(
    card.getByText('TOKEN (value hidden)', { exact: true }),
  ).toBeVisible()
  await expect(
    card.getByLabel('engine credential value', { exact: true }),
  ).toHaveValue('')
  await expect(card).not.toContainText('private-credential')
  await card
    .getByRole('button', { name: 'Remove TOKEN binding', exact: true })
    .click()
  await expect(
    card.getByText('TOKEN (value hidden)', { exact: true }),
  ).toHaveCount(0)
})
