import { expect, test } from '@playwright/test'
import { APP_ID } from '@sb/core/const'
import { folder, loadedPages } from '~/tests/browser/session-folders-helpers'

test('root folders and sessions start at ten while subfolders share their five-item budget', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manyFolders&manySessions')
  const counts = async () =>
    JSON.parse((await page.getByTestId('loaded-folders').textContent()) ?? '{}')
  await expect.poll(async () => (await counts()).ungrouped).toBe(10)
  await expect.poll(async () => (await loadedPages(page)).ungrouped).toBe(10)
  await expect.poll(async () => (await counts()).a).toBe(5)
  await expect.poll(async () => (await loadedPages(page)).a).toBe(0)
  await expect(folder(page, 'Root folder 30')).toHaveCount(0)
  expect((await loadedPages(page))['root-folder-29']).toBeUndefined()

  const childMore = page.locator('[data-page-footer="a"] button')
  await childMore.click()
  await expect.poll(async () => (await counts()).a).toBe(25)
  await expect.poll(async () => (await loadedPages(page)).a).toBe(0)
  await childMore.click()
  await expect.poll(async () => (await counts()).a).toBe(31)
  await expect.poll(async () => (await loadedPages(page)).a).toBe(14)

  const rootMore = page.locator('[data-page-footer="ungrouped"] button')
  await rootMore.click()
  await expect.poll(async () => (await counts()).ungrouped).toBe(30)
  await expect.poll(async () => (await loadedPages(page)).ungrouped).toBe(10)
  await expect(rootMore).toBeEnabled()
  await rootMore.click()
  await expect.poll(async () => (await counts()).ungrouped).toBe(32)
  await expect.poll(async () => (await loadedPages(page)).ungrouped).toBe(28)
})

test('Pinned paginates folders before sessions and supports unloaded real ancestors', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions&manyPinnedFolders')
  const counts = async () =>
    JSON.parse((await page.getByTestId('loaded-folders').textContent()) ?? '{}')
  await expect.poll(async () => (await counts()).pinned).toBe(5)
  await expect.poll(async () => (await loadedPages(page)).pinned).toBe(0)
  await expect(folder(page, 'Pinned folder 6')).toHaveCount(0)
  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBeUndefined()
  await page.locator('[data-page-footer="pinned"] button').click()
  await expect.poll(async () => (await counts()).pinned).toBe(12)
  await expect.poll(async () => (await loadedPages(page)).pinned).toBe(13)
  await expect(folder(page, 'Pinned folder 12')).toHaveCount(1)
})

test('picker searches unloaded folders and inherited collapse choices do not fetch hidden branches', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manyFolders')
  await expect(folder(page, 'Portfolio')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse all folders' }).click()
  await page.locator('[data-page-footer="ungrouped"] button').click()
  await expect(folder(page, 'Root folder 20')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  expect((await loadedPages(page))['root-folder-19']).toBeUndefined()
  const picker = page.getByRole('combobox', {
    name: 'Session folder',
    exact: true,
  })
  await picker.click()
  await page.getByPlaceholder('Search folders…').fill('Root folder 30')
  await page
    .getByRole('option', { name: 'Root folder 30', exact: true })
    .click()
  await expect(picker).toHaveText('Root folder 30')
  await expect(folder(page, 'Root folder 30')).toHaveCount(0)
})

test('a delayed first page animates into place without a loading label', async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ a: true })),
    `${APP_ID}-session-folder-collapse`,
  )
  await page.goto('/?fixture=session-folders&manySessions&slowSessions')
  await expect(folder(page, 'Portfolio')).toBeVisible()
  await folder(page, 'Portfolio').click()
  const branch = page.locator('[data-session-folder="a"]')
  await expect(branch.getByRole('status')).toHaveCount(0)
  await expect(branch.getByText('Portfolio chat', { exact: true })).toHaveCount(
    0,
  )
  const heights = await branch.evaluate(async (element) => {
    const content = element.querySelector<HTMLElement>(
      ':scope > [data-slot="collapsible-content"]',
    )!
    await new Promise<void>((resolve) => {
      const wait = () =>
        content.getAnimations().length ? requestAnimationFrame(wait) : resolve()
      requestAnimationFrame(wait)
    })
    const samples = [content.getBoundingClientRect().height]
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Resolve session queries')!
      .click()
    const start = performance.now()
    while (performance.now() - start < 450) {
      await new Promise(requestAnimationFrame)
      samples.push(content.getBoundingClientRect().height)
    }
    return samples
  })
  await expect(
    branch.getByText('Portfolio chat', { exact: true }),
  ).toBeVisible()
  const initial = heights[0]!
  const final = heights.at(-1)!
  expect(final).toBeGreaterThan(initial)
  expect(
    heights.some((height) => height > initial + 1 && height < final - 1),
  ).toBe(true)
  await expect(branch.getByRole('status')).toHaveCount(0)
})

test('visible collapsed folders preload their first page without fetching hidden descendants', async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ a: true, n: true })),
    `${APP_ID}-session-folder-collapse`,
  )
  await page.goto('/?fixture=session-folders&manySessions&slowSessions')
  await expect(folder(page, 'Portfolio')).toBeVisible()
  await expect(folder(page, 'Design')).toHaveCount(0)
  await page.getByRole('button', { name: 'Resolve session queries' }).click()
  await folder(page, 'Portfolio').click()
  await expect(page.getByText('Portfolio chat', { exact: true })).toBeVisible()
  await expect(folder(page, 'Design')).toHaveAttribute('aria-expanded', 'false')

  await folder(page, 'Design').click()
  const branch = page.locator('[data-session-folder="n"]')
  await expect(branch.getByText('Design chat', { exact: true })).toHaveCount(0)
  await expect(branch.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Resolve session queries' }).click()
  await expect(branch.getByText('Design chat', { exact: true })).toBeVisible()

  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBeUndefined()
  await folder(page, 'Portfolio').click()
  await expect(page.getByText('Portfolio chat', { exact: true })).toBeVisible()
})

test('picker preloads before opening without loading indicators and resets additional pages on close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1200 })
  await page.goto('/?fixture=session-folders&slowFolders&manyFolders')
  const picker = page.getByRole('combobox', {
    name: 'Session folder',
    exact: true,
  })
  const parentPicker = page.getByRole('combobox', { name: 'Parent folder' })
  const clear = page.getByRole('button', { name: 'Clear session folder' })

  await expect(picker).toBeDisabled()
  await expect(parentPicker).toBeDisabled()
  await expect(clear).toBeDisabled()
  await expect(picker.getByRole('status')).toHaveCount(0)
  await expect(picker).toHaveText('Session folder')
  await expect(picker).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByPlaceholder('Search folders…')).toHaveCount(0)

  await page.evaluate(() =>
    window.dispatchEvent(new Event('resolve-folder-queries')),
  )
  await expect(picker).toBeEnabled()
  await expect(parentPicker).toBeEnabled()
  await expect(clear).toBeEnabled()
  await expect(picker).toHaveText('Portfolio / Design')
  await picker.click()
  await expect(picker).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('option')).toHaveCount(21)
  await expect(
    page.getByRole('option', { name: 'Portfolio', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('listbox').getByRole('status')).toHaveCount(0)

  await page.getByRole('button', { name: 'Load more folders' }).click()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('resolve-folder-queries')),
  )
  await expect(page.getByRole('option')).toHaveCount(41)
  await page.keyboard.press('Escape')
  await expect(picker).toBeFocused()
  await picker.click()
  await expect(picker).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('option')).toHaveCount(21)
  await expect(page.getByRole('listbox').getByRole('status')).toHaveCount(0)
})

test('empty chat waits for the selected folder instead of flashing the welcome heading', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&emptyChat&slowFolders')
  const chat = page.getByTestId('empty-chat')
  const genericLabel = 'What’s on your mind?'
  await expect(chat.getByText(genericLabel, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resolve session queries' }).click()
  await page
    .getByRole('button', { name: 'Compose in Portfolio', exact: true })
    .click()

  const picker = chat.getByRole('combobox', {
    name: 'Session folder',
    exact: true,
  })
  await expect(picker).toBeDisabled()
  await expect(chat).not.toContainText(genericLabel)
  await page.getByRole('button', { name: 'Resolve session queries' }).click()
  await expect(
    chat.getByText('Portfolio', { exact: true }).first(),
  ).toBeVisible()

  await page
    .getByRole('button', { name: 'Compose in SlopBench', exact: true })
    .click()
  await expect(picker).toBeDisabled()
  await expect(chat).not.toContainText(genericLabel)
  await expect(chat.getByText('Portfolio', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Resolve session queries' }).click()
  await expect(
    chat.getByText('SlopBench', { exact: true }).first(),
  ).toBeVisible()

  await chat.getByRole('button', { name: 'Clear session folder' }).click()
  await expect(chat.getByText(genericLabel, { exact: true })).toBeVisible()
})
