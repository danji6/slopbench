import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=skills')
})

test('folder picker remembers confirmed selections across reloads, with no parent row', async ({
  page,
}) => {
  const choose = page.getByRole('button', {
    name: 'Choose directory',
    exact: true,
  })
  const picker = page.getByRole('dialog')
  const path = picker.getByPlaceholder('/path/to/project')
  const recent = () =>
    page.evaluate(() => localStorage.getItem('slopbench-recent-directories'))
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await choose.click()
  await expect(
    picker.getByRole('button', { name: 'Up', exact: true }),
  ).toBeEnabled()
  await expect(
    picker.getByRole('option', { name: '..', exact: true }),
  ).toHaveCount(0)
  await picker.getByRole('option', { name: 'project', exact: true }).click()
  await expect(path).toHaveValue('/fixture/custom-home/project')
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await recent()).toBeNull()

  await choose.click()
  await path.fill('/missing')
  await path.press('Escape')
  await picker
    .getByRole('button', { name: 'Use this folder', exact: true })
    .click()
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('alert')).toHaveText('Directory not found')
  await expect(path).toHaveAttribute('aria-invalid', 'true')
  await expect(path).toHaveValue('/missing')
  await expect(
    picker.getByRole('button', { name: 'Use this folder', exact: true }),
  ).toBeEnabled()
  expect(await recent()).toBeNull()
  await path.fill('/fixture/custom-home/project')
  await path.press('Escape')
  await expect(picker.getByRole('alert')).toHaveCount(0)
  await picker
    .getByRole('button', { name: 'Use this folder', exact: true })
    .click()
  await expect(picker).toHaveCount(0)
  expect(JSON.parse((await recent())!)).toEqual({
    paths: ['/fixture/custom-home/project'],
  })

  await expect(choose).toBeEnabled()
  await page.reload()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await choose.click()
  const directories = picker.getByRole('listbox', { name: 'Directories' })
  await expect(
    directories.getByText('/fixture/custom-home/project'),
  ).toHaveCount(0)
  await path.click()
  const suggestions = page.getByRole('listbox', { name: 'Recent folders' })
  await expect(suggestions).toBeVisible()
  await path.press('ArrowDown')
  await expect(
    suggestions.getByRole('option', {
      name: '/fixture/custom-home/project',
      exact: true,
    }),
  ).toHaveAttribute('data-highlighted')
  await path.press('Enter')
  await expect(path).toHaveValue('/fixture/custom-home/project')
  await expect(
    picker.getByRole('option', { name: 'project', exact: true }),
  ).toBeFocused()
})

test('path bar fuzzy searches recent folders and keeps arbitrary paths navigable', async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'slopbench-recent-directories',
      JSON.stringify({
        paths: [
          '/fixture/custom-home/project',
          '/fixture/archives',
          '/fixture/research',
        ],
      }),
    )
  })
  await page.reload()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page
    .getByRole('button', { name: 'Choose directory', exact: true })
    .click()
  const picker = page.getByRole('dialog')
  const path = picker.getByRole('combobox', { name: 'Folder path' })
  const suggestions = page.getByRole('listbox', { name: 'Recent folders' })
  await expect(suggestions).toHaveCount(0)
  await path.click()
  await expect(suggestions.getByRole('option')).toHaveCount(3)
  await path.fill('prject')
  await expect(suggestions.getByRole('option')).toHaveCount(1)
  await suggestions
    .getByRole('option', { name: '/fixture/custom-home/project', exact: true })
    .click()
  await expect(path).toHaveValue('/fixture/custom-home/project')
  await expect(suggestions).toHaveCount(0)

  await path.click()
  await expect(suggestions.getByRole('option')).toHaveCount(3)
  await path.fill('zzzzzzzzzz')
  await expect(
    page.getByText('No matching recent folders.', { exact: true }),
  ).toBeVisible()
  await path.press('Escape')
  await expect(suggestions).toHaveCount(0)
  await expect(picker).toBeVisible()
  await path.fill('/fixture/new-folder')
  await path.press('Enter')
  await expect(path).toHaveValue('/fixture/new-folder')
  await expect(
    picker.getByRole('option', { name: 'project', exact: true }),
  ).toBeFocused()
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('slopbench-recent-directories')!).paths,
    ),
  ).toEqual([
    '/fixture/custom-home/project',
    '/fixture/archives',
    '/fixture/research',
  ])
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

test('an unassigned folder has no managed label and selecting its first folder needs no change confirmation', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Choose directory', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Use this folder', exact: true })
    .click()
  await expect(
    page.getByText('Change personal folder?', { exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText('Updating files…')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Detach folder', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Inspect last operation' }).click()
  await expect(page.getByLabel('Last operation')).toContainText(
    '"copyFiles":false',
  )
})

test('folder status waits for disk inspection and detects a folder removed outside the app', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.getByText('Checking personal folder…')).toBeVisible()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toHaveCount(0)
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Remove fixture folder on disk' })
    .click()
  await expect(
    page.getByText('The assigned folder is missing.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Recreate folder', exact: true })
    .click()
  await expect(page.getByText('Updating files…')).toBeVisible()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toBeVisible()
})

test('managed folders can be detached with optional deletion, while custom folders are preserved', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Detach folder', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Delete files', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Keep files', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Inspect last operation' }).click()
  await expect(page.getByLabel('Last operation')).toContainText(
    '"removeFolder":false',
  )
  await page
    .getByRole('button', { name: 'Assign custom fixture folder' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Use managed folder', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Delete folder', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Detach folder', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Delete files', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText('The files will be preserved', { exact: false }),
  ).toBeVisible()
})

test('delete folder explicitly detaches and removes a managed folder', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click()
  await expect(
    page.getByText('Delete personal folder?', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Delete folder', exact: true })
    .last()
    .click()
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Inspect last operation' }).click()
  await expect(page.getByLabel('Last operation')).toContainText(
    '"removeFolder":true',
  )
})

test('managed detach dialog keeps action labels inside their buttons', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Detach folder', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()

  for (const width of [760, 320, 220]) {
    await page.setViewportSize({ width, height: 600 })
    await expect
      .poll(() =>
        dialog.getByRole('button').evaluateAll((buttons) =>
          buttons.every((button) => {
            const box = button.getBoundingClientRect()
            const walker = document.createTreeWalker(
              button,
              NodeFilter.SHOW_TEXT,
            )
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent?.trim()) continue
              const range = document.createRange()
              range.selectNodeContents(walker.currentNode)
              const fits = Array.from(range.getClientRects()).every(
                (rect) =>
                  rect.left >= box.left &&
                  rect.right <= box.right &&
                  rect.top >= box.top &&
                  rect.bottom <= box.bottom,
              )
              if (!fits) return false
            }
            return button.scrollWidth <= button.clientWidth
          }),
        ),
      )
      .toBe(true)
    if (width === 320) {
      await page.screenshot({ path: '/tmp/slopbench-detach-dialog.png' })
    }
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Detach folder', exact: true }),
  ).toBeEnabled()
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
  await page
    .getByRole('searchbox', { name: 'Search skill names' })
    .fill('skill-01')
  await expect(list.getByText('No skills found.')).toBeVisible()
  await page
    .getByRole('searchbox', { name: 'Search skill names' })
    .fill('skill-00')
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
    const before = await page.getByRole('searchbox').boundingBox()
    await list.evaluate((element) => {
      element.scrollTop = 250
    })
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
