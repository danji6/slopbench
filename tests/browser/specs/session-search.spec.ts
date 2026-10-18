import { type Page, expect, test } from '@playwright/test'

import { loadedPages } from '../session-folders-helpers'

const search = (page: Page) =>
  page.getByRole('textbox', { name: 'Search sessions' })
const results = (page: Page) => page.locator('[data-session-page="search"]')

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=session-folders&searchFixtures')
})

test('combines folder descendants, titles, participant kinds, and alternatives', async ({
  page,
}) => {
  await search(page).fill('folder:Portfolio')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(2)
  await expect(results(page)).toContainText('Portfolio chat')
  await expect(results(page)).toContainText('Design chat')
  await expect(results(page)).not.toContainText('SlopBench chat')

  await search(page).fill(
    'chat folder:Portfolio agent:Missing,"Codebase Explorer" user:Jane',
  )
  await expect.poll(async () => (await loadedPages(page)).search).toBe(1)
  await expect(results(page)).toContainText('Design chat')

  await search(page).fill('user:Alice')
  await expect(results(page)).toContainText('No matching sessions')
  await search(page).fill('participant:Alice')
  await expect(results(page)).toContainText('Portfolio chat')
})

test('handles quoted commas, escaped quotes, and unfinished input', async ({
  page,
}) => {
  await search(page).fill('agent:"Code,Codebase Explorer"')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(1)
  await expect(results(page)).toContainText('SlopBench chat')

  await search(page).fill('agent:Code,"Codebase Explorer"')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(2)
  await search(page).fill('agent:"Alice \\"The Architect\\""')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(1)
  await expect(results(page)).toContainText('Portfolio chat')

  await search(page).fill('agent:"Codebase')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(2)
  await search(page).fill('agent:')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(3)
})

test('automatically fills sparse results and loads twenty more matches', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&searchFixtures&manySessions')
  await search(page).fill('agent:"Rare Agent"')
  await expect
    .poll(async () => (await loadedPages(page)).search)
    .toBeGreaterThanOrEqual(20)
  const first = (await loadedPages(page)).search
  const loadMore = results(page).getByRole('button', { name: 'Load more' })
  await expect(loadMore).toBeEnabled()
  const firstTitle = await results(page)
    .getByRole('button')
    .first()
    .textContent()
  await loadMore.click()
  await expect
    .poll(async () => (await loadedPages(page)).search)
    .toBeGreaterThanOrEqual(first + 20)
  await expect(loadMore).toBeEnabled()
  await expect(results(page).getByRole('button').first()).toHaveText(
    firstTitle!,
  )
})

test('changes a sparse query during loading and restores the tree when cleared', async ({
  page,
}) => {
  await page.goto(
    '/?fixture=session-folders&searchFixtures&manySessions&slowSessions',
  )
  await search(page).fill('agent:"Rare Agent"')
  const resolve = page.getByRole('button', { name: 'Resolve session queries' })
  for (let i = 0; i < 3; i++) {
    await resolve.click()
    await expect(results(page)).not.toContainText('No matching sessions')
  }
  await search(page).fill('Design chat')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(0)
  await resolve.click()
  await expect(results(page)).toContainText('Design chat')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(1)
  await search(page).fill('')
  await expect(
    page.getByRole('button', { name: 'Portfolio', exact: true }),
  ).toBeVisible()
  await expect(results(page)).toHaveCount(0)
})

test('hidden-session visibility resets a filtered search', async ({ page }) => {
  await search(page).fill('agent:"Hidden Agent"')
  await expect(results(page)).toContainText('No matching sessions')
  await page.getByRole('button', { name: 'Session list options' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Show hidden' }).click()
  await page.keyboard.press('Escape')
  await expect(results(page)).toContainText('Hidden chat')
})

test('syntax help is keyboard accessible and documents quote semantics', async ({
  page,
}) => {
  const help = page.getByRole('button', { name: 'Search filter help' })
  await help.focus()
  await page.keyboard.press('Enter')
  const popover = page.getByRole('dialog', { name: 'Search filters' })
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('folder:Project')
  await expect(popover).toContainText('participant:Alice')
  await expect(popover).toContainText('agent:Code,"Codebase Explorer"')
  await expect(popover).toContainText('agent:"Alice \\"The Architect\\""')
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(help).toBeFocused()
})
