import { type Locator, type Page, expect, test } from '@playwright/test'

async function drag(
  page: Page,
  source: Locator,
  destination: Locator,
  bottom = false,
) {
  const from = (await source.boundingBox())!
  const to = (await destination.boundingBox())!
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 12, y, { steps: 3 })
  await page.mouse.move(
    to.x + to.width / 2,
    bottom ? to.y + to.height - 10 : to.y + to.height / 2,
    {
      steps: 12,
    },
  )
  await page.mouse.up()
}

async function folderState(page: Page) {
  return JSON.parse(
    (await page.getByTestId('folder-state').textContent())!,
  ) as {
    _id: string
    parentId?: string
    pinned?: boolean
  }[]
}

const folder = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })

async function pinFolder(page: Page, name: string) {
  await page.getByRole('button', { name: `Options for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'session-folder-collapse',
      JSON.stringify({ ungrouped: true }),
    )
  })
  await page.goto('/?fixture=session-folders')
  await expect(folder(page, 'Portfolio')).toBeVisible()
})

test('picker deselects, clears without opening, restores focus, and respects disabled state', async ({
  page,
}) => {
  const picker = page.getByRole('combobox', {
    name: 'Session folder',
    exact: true,
  })
  await expect(picker).toHaveText('Portfolio / Design')
  await expect(
    page.getByRole('combobox', { name: 'Parent folder' }),
  ).toHaveText('Top level')
  await picker.click()
  await page
    .getByRole('option', { name: 'Portfolio / Design', exact: true })
    .click()
  await expect(page.getByTestId('selected-folder')).toHaveText('none')
  await expect(picker).toHaveText('No folder')
  await picker.click()
  await page
    .getByRole('option', { name: 'Portfolio / Design', exact: true })
    .click()
  await page.getByRole('button', { name: 'Clear session folder' }).click()
  await expect(picker).toBeFocused()
  await expect(picker).toHaveAttribute('aria-expanded', 'false')
  await expect(picker).toHaveText('No folder')
  await expect(
    page.getByRole('button', { name: 'Clear session folder' }),
  ).toHaveCount(0)
  await picker.click()
  await page.getByRole('option', { name: 'Portfolio', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Disable picker' }).check()
  await expect(picker).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Clear session folder' }),
  ).toBeDisabled()
})

test('folder buttons have independent focus and matching menus, and Compose targets the folder', async ({
  page,
}) => {
  const header = folder(page, 'Portfolio')
  const compose = page.getByRole('button', { name: 'Compose in Portfolio' })
  const options = page.getByRole('button', { name: 'Options for Portfolio' })
  await compose.focus()
  await compose.hover()
  await expect(compose).toBeFocused()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  expect(
    await header.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe('rgba(0, 0, 0, 0)')
  await header.click({ button: 'right' })
  const contextItems = await page.getByRole('menuitem').allTextContents()
  await page.keyboard.press('Escape')
  await options.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  expect(await page.getByRole('menuitem').allTextContents()).toEqual(
    contextItems,
  )
  await page.keyboard.press('Escape')
  await expect(options).toBeFocused()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await compose.click()
  await expect(page).toHaveURL(/folder=a/)
  await expect(header).toHaveAttribute('aria-expanded', 'true')
})

test('pinned parent, child, and session appear once and restore their original location', async ({
  page,
}) => {
  await pinFolder(page, 'Portfolio')
  await pinFolder(page, 'Design')
  await expect(folder(page, 'Portfolio')).toHaveCount(1)
  await expect(folder(page, 'Design')).toHaveCount(1)
  await page
    .getByRole('button', { name: 'Design chat', exact: false })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Design chat', exact: false }),
  ).toHaveCount(1)
  await folder(page, 'Portfolio').click()
  await expect(page.getByText('Portfolio chat', { exact: true })).toBeHidden()
  await expect(folder(page, 'Design')).toBeVisible()
  await folder(page, 'Pinned').click()
  await expect(folder(page, 'Portfolio')).toBeHidden()
  await expect(folder(page, 'Design')).toBeHidden()
  await expect(page.getByText('Design chat', { exact: true })).toBeHidden()
  await folder(page, 'Pinned').click()
  await expect(
    page.getByTestId('sidebar').locator('[class*="starting:grid-rows"]'),
  ).toHaveCount(0)
  await folder(page, 'Design').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
  await expect(folder(page, 'Design')).toBeHidden()
  await folder(page, 'Portfolio').click()
  await expect(folder(page, 'Design')).toBeVisible()
  expect(
    (await folderState(page)).find((entry) => entry._id === 'n'),
  ).toMatchObject({ parentId: 'a', pinned: false })
})

test('folder drops pin without reparenting, moves preserve pins, and the separator accepts sessions', async ({
  page,
}) => {
  await drag(page, folder(page, 'Design'), folder(page, 'Pinned'))
  await expect
    .poll(
      async () =>
        (await folderState(page)).find((entry) => entry._id === 'n')?.pinned,
    )
    .toBe(true)
  expect(
    (await folderState(page)).find((entry) => entry._id === 'n')?.parentId,
  ).toBe('a')
  await expect(folder(page, 'Design')).toHaveCount(1)
  await drag(page, folder(page, 'Design'), folder(page, 'SlopBench'))
  await expect
    .poll(
      async () =>
        (await folderState(page)).find((entry) => entry._id === 'n')?.parentId,
    )
    .toBe('b')
  expect(
    (await folderState(page)).find((entry) => entry._id === 'n')?.pinned,
  ).toBe(true)
  const separator = page.getByRole('separator', {
    name: 'Sessions without a folder',
  })
  await expect(separator).toBeVisible()
  await expect(folder(page, 'Ungrouped')).toHaveCount(0)
  await drag(
    page,
    page.getByRole('button', { name: 'Portfolio chat', exact: false }),
    separator,
  )
  await folder(page, 'Portfolio').click()
  await expect(page.getByText('Portfolio chat', { exact: true })).toBeVisible()
  await drag(
    page,
    page.getByRole('button', { name: 'Design chat', exact: false }),
    page.getByTestId('sidebar'),
    true,
  )
  await folder(page, 'Design').click()
  await expect(page.getByText('Design chat', { exact: true })).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Search sessions' })
    .fill('Portfolio chat')
  await expect(separator).toHaveCount(0)
  await expect(page.getByText('Portfolio chat', { exact: true })).toHaveCount(1)
})

test('narrow sidebar controls fit in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 1000 })
  for (const dark of [false, true]) {
    if (dark) await page.getByRole('button', { name: 'Toggle theme' }).click()
    const header = folder(page, 'Portfolio')
    const options = page.getByRole('button', { name: 'Options for Portfolio' })
    const compose = page.getByRole('button', { name: 'Compose in Portfolio' })
    const foreground = await page
      .getByTestId('sidebar')
      .evaluate((element) => getComputedStyle(element).color)
    await expect(header).toHaveCSS('color', foreground)
    const boxes = await Promise.all([
      header.boundingBox(),
      compose.boundingBox(),
      options.boundingBox(),
    ])
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x)
    expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x)
    expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(260)
    await page.screenshot({
      path: `/tmp/slopbench-session-folders-${dark ? 'dark' : 'light'}.png`,
    })
  }
})
