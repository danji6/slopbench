import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=skills')
})

test('skill toggles persist per agent while sharing assignments and leaving the library unchanged', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Share fixture folder', exact: true })
    .click()
  const toggle = page.getByRole('switch', {
    name: 'Enable skill-00',
    exact: true,
  })
  await expect(toggle).toBeChecked()
  await expect(page.getByRole('switch')).toHaveCount(1)
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(
    page.getByText('Changes affect every agent using it.', { exact: false }),
  ).toBeVisible()
  await page.getByRole('searchbox').fill('skill-00')
  await expect(toggle).not.toBeChecked()
  await page
    .getByRole('button', { name: 'Other agent settings', exact: true })
    .click()
  await expect(toggle).toBeChecked()
  await page
    .getByRole('button', { name: 'Agent settings', exact: true })
    .click()
  await expect(toggle).not.toBeChecked()
  await page.getByRole('button', { name: 'Skill library', exact: true }).click()
  await expect(page.getByRole('switch')).toHaveCount(0)
  await expect(page.getByText('skill-00', { exact: true })).toBeVisible()
  await page.reload()
  await page
    .getByRole('button', { name: 'Assign managed fixture folder', exact: true })
    .click()
  await expect(toggle).not.toBeChecked()
  await toggle.press('Space')
  await expect(toggle).toBeChecked()
})

test('failed skill toggles retain the saved state and allow retry', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder', exact: true })
    .click()
  const toggle = page.getByRole('switch', {
    name: 'Enable skill-00',
    exact: true,
  })
  await expect(toggle).toBeChecked()
  await page
    .getByRole('button', { name: 'Fail next operation', exact: true })
    .click()
  await toggle.click()
  await expect(page.getByRole('alert')).toHaveText('Fixture toggle failed')
  await expect(toggle).toBeChecked()
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('descriptions expand from two lines and the library scrolls beyond its first page', async ({
  page,
}) => {
  const description = page
    .getByText('A deliberately long skill description', { exact: false })
    .first()
  await expect(description).toHaveCSS('-webkit-line-clamp', '2')
  await page.getByRole('button', { name: 'Show more' }).first().click()
  await expect(description).not.toHaveCSS('-webkit-line-clamp', '2')
  await page.getByRole('button', { name: 'Show less' }).first().click()
  const library = page.getByLabel('Agent skills', { exact: true })
  await expect(library.getByText('skill-00', { exact: true })).toBeVisible()
  for (let i = 0; i < 12; i++) {
    await library.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    if (await library.getByText('skill-84', { exact: true }).count()) break
    await page.waitForTimeout(150)
  }
  await expect(library.getByText('skill-84', { exact: true })).toBeVisible()
})

test('busy feedback and Add buttons stay stable during delayed operation handoffs', async ({
  page,
}) => {
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByText('skill-01', { exact: true }) })
  const add = row.getByRole('button', { name: 'Add', exact: true })
  await add.click()
  for (let i = 0; i < 10; i++) {
    await expect(page.getByText('Updating files…').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Add', exact: true }).nth(1),
    ).toBeDisabled()
    await page.waitForTimeout(80)
  }
  await expect(page.getByText('Updating files…')).toHaveCount(0)
  await expect(row.getByText('(Added)', { exact: true })).toBeVisible()
  await expect(
    row.getByRole('button', { name: 'Remove', exact: true }),
  ).toBeEnabled()
})

test('errors are brief, dismissible, and do not return after changing tabs', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Fail next operation' }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).nth(1).click()
  await expect(
    page.getByText('Fixture operation failed', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Uncaught ConvexError', { exact: false }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Dismiss error' }).click()
  await page.getByRole('button', { name: 'Skill library', exact: true }).click()
  await page
    .getByRole('button', { name: 'Agent settings', exact: true })
    .click()
  await expect(page.getByText('Fixture operation failed')).toHaveCount(0)
})

test('retry holds busy while the previous failed query is replaced', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Fail next operation' }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).nth(1).click()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  for (let i = 0; i < 8; i++) {
    await expect(page.getByText('Updating files…').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Add', exact: true }).nth(1),
    ).toBeDisabled()
    await page.waitForTimeout(80)
  }
  await expect(page.getByText('Updating files…')).toHaveCount(0)
  await expect(page.getByText('Fixture operation failed')).toHaveCount(0)
})

test('assignment filters combine with search and removed skills stay in the list', async ({
  page,
}) => {
  const list = page.getByRole('list', { name: 'Agent skills', exact: true })
  const row = list
    .getByRole('listitem')
    .filter({ has: page.getByText('skill-00', { exact: true }) })
  const filter = page.getByRole('button', { name: /^Filter/ })
  await expect(row.getByText('(Added)', { exact: true })).toBeVisible()
  await expect(
    row.getByRole('button', { name: 'Add', exact: true }),
  ).toBeDisabled()
  await filter.click()
  await page.getByRole('menuitemradio', { name: 'Added', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search skills' }).fill('skill-01')
  await expect(list.getByText('No skills found.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search skills' }).fill('skill-00')
  await expect(row).toBeVisible()
  await filter.click()
  await page
    .getByRole('menuitemradio', { name: 'Not added', exact: true })
    .click()
  await expect(list.getByText('No skills found.')).toBeVisible()
  await filter.click()
  await page
    .getByRole('menuitemradio', { name: 'All skills', exact: true })
    .click()
  await row.getByRole('button', { name: 'Remove', exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toContainText('Any edits the agent has done')
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(row.getByText('(Added)', { exact: true })).toBeVisible()
  await row.getByRole('button', { name: 'Remove', exact: true }).click()
  await confirmation
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(row.getByText('(Added)', { exact: true })).toHaveCount(0)
  await expect(
    row.getByRole('button', { name: 'Remove', exact: true }),
  ).toHaveCount(0)
  await expect(
    row.getByRole('button', { name: 'Add', exact: true }),
  ).toBeEnabled()
  await filter.click()
  await page
    .getByRole('menuitemradio', { name: 'Not added', exact: true })
    .click()
  await expect(row).toBeVisible()
})

test('only the skills list scrolls while search and filter stay visible', async ({
  page,
}) => {
  for (const width of [1000, 375]) {
    await page.setViewportSize({ width, height: 800 })
    const panel = page.getByRole('tabpanel')
    const list = page.getByRole('list', { name: 'Agent skills', exact: true })
    await expect(list.getByRole('listitem').first()).toBeVisible()
    await page.getByRole('button', { name: 'Show more' }).first().click()
    await expect
      .poll(() =>
        panel.evaluate(
          (element) =>
            element.scrollHeight <= element.clientHeight &&
            element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Show less' }).first().click()
    await list.hover()
    const before = await page.getByRole('searchbox').boundingBox()
    await page.mouse.wheel(0, 250)
    await expect
      .poll(() => list.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    expect(await page.getByRole('searchbox').boundingBox()).toEqual(before)
    await expect(page.getByRole('button', { name: /^Filter/ })).toBeVisible()
    await expect
      .poll(() =>
        list.evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true)
    await list.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(list.getByText('skill-00', { exact: true })).toBeInViewport()
    if (width === 1000) {
      await page.getByRole('button', { name: /^Filter/ }).click()
      await expect(page.getByRole('menu')).toHaveCSS('opacity', '1')
      await panel.screenshot({ path: '/tmp/slopbench-agent-skills.png' })
      await page.getByRole('menu').press('Escape')
    }
  }
})
