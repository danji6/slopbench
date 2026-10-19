import { expect, test } from '@playwright/test'
import { APP_ID } from '@sb/core/const'

import {
  drag,
  folder,
  folderState,
  loadedPages,
  openSessionFolders,
  pinFolder,
} from '../session-folders-helpers'

test.beforeEach(async ({ page }) => openSessionFolders(page))

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
  await page
    .locator(
      '[data-session-folder="pinned"] > [data-slot="collapsible-content"]',
    )
    .evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      )
    })
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
    separator,
  )
  await folder(page, 'Design').click()
  await expect(page.getByText('Design chat', { exact: true })).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Search sessions' })
    .fill('Portfolio chat')
  await expect(separator).toHaveCount(0)
  await expect(page.getByText('Portfolio chat', { exact: true })).toHaveCount(1)
})

test('folder controls retain sibling collapse state and refresh pin actions after page updates', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions')
  await folder(page, 'SlopBench').click()
  await expect.poll(async () => (await loadedPages(page)).b).toBeUndefined()
  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBeUndefined()
  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(5)
  await page
    .locator('[data-session-folder="a"]')
    .getByRole('button', { name: 'Load more' })
    .last()
    .click()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(25)

  for (const pinned of [true, false, true, false]) {
    await page.getByRole('button', { name: 'Options for Portfolio' }).click()
    await page
      .getByRole('menuitem', { name: pinned ? 'Pin' : 'Unpin', exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (await folderState(page)).find((entry) => entry._id === 'a')?.pinned,
      )
      .toBe(pinned)
    await expect(folder(page, 'SlopBench')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect.poll(async () => (await loadedPages(page)).b).toBeUndefined()
  }

  await expect
    .poll(() =>
      page.evaluate(
        (appId) =>
          JSON.parse(localStorage.getItem(`${appId}-session-folder-collapse`)!),
        APP_ID,
      ),
    )
    .toMatchObject({ a: false, b: true })
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
    const row = await header.evaluate((element) => {
      const { x, width } = element.parentElement!.getBoundingClientRect()
      const label = element.querySelector('span.truncate')!
      return { x, width, labelRight: label.getBoundingClientRect().right }
    })
    expect(boxes[0]!.x).toBe(row.x)
    expect(boxes[0]!.width).toBe(row.width)
    expect(row.labelRight).toBeLessThanOrEqual(boxes[1]!.x)
    expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x)
    expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(260)
    await header.hover({ position: { x: 8, y: 18 } })
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/slopbench-session-folders-${dark ? 'dark' : 'light'}.png`,
    })
  }
})
