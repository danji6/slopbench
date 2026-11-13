import { type Page, expect, test } from '@playwright/test'
import {
  drag,
  dragTo,
  folder,
  loadedPages,
  openSessionFolders,
} from '~/tests/browser/session-folders-helpers'

test.beforeEach(async ({ page }) => openSessionFolders(page))

async function samplePageExpansion(page: Page, groupKey: string) {
  const content = page.locator(`[data-session-page="${groupKey}"]`)
  await content
    .locator(`[data-page-footer="${groupKey}"] button`)
    .scrollIntoViewIfNeeded()
  await content.locator(`[data-page-footer="${groupKey}"] button`).focus()
  return content.evaluate(async (element) => {
    await new Promise(requestAnimationFrame)
    const scrollArea = element.closest(
      '[data-slot="session-list-scroll-area"]',
    )!
    const firstRow = element.querySelector('button')!
    const section = element.closest('[data-session-folder]') ?? element
    const initialTop = firstRow.getBoundingClientRect().top
    const button = element.querySelector<HTMLButtonElement>(
      `[data-page-footer="${element.getAttribute('data-session-page')}"] button`,
    )!
    const surface =
      element
        .closest('[data-session-folder]')
        ?.querySelector<HTMLElement>(
          ':scope > [data-slot="collapsible-content"]',
        ) ?? element
    const read = () => ({
      height: surface.getBoundingClientRect().height,
      sectionHeight: section.getBoundingClientRect().height,
      scrollTop: scrollArea.scrollTop,
      firstTop: firstRow.getBoundingClientRect().top,
      sameRow: element.querySelector('button') === firstRow,
      animations: surface.getAnimations().length,
    })
    const samples = [read()]
    button.click()
    const start = performance.now()
    while (performance.now() - start < 450) {
      await new Promise(requestAnimationFrame)
      samples.push(read())
    }
    return {
      samples,
      initialTop,
      heightStyle: (surface as HTMLElement).style.height,
    }
  })
}

test('load more reveals one container in folders, unfiled sessions, and search without moving existing rows', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions')
  for (const groupKey of ['a', 'ungrouped', 'search']) {
    if (groupKey === 'search') {
      await page
        .getByRole('textbox', { name: 'Search sessions' })
        .fill('session')
      await expect.poll(async () => (await loadedPages(page)).search).toBe(20)
    }
    const { samples, initialTop, heightStyle } = await samplePageExpansion(page, groupKey) // prettier-ignore
    const initial = samples[0]!
    const final = samples.at(-1)!
    expect(final.height).toBeGreaterThan(initial.height)
    expect(
      samples.some(
        ({ height }) =>
          height > initial.height + 1 && height < final.height - 1,
      ),
    ).toBe(true)
    expect(Math.max(...samples.map(({ animations }) => animations))).toBe(1)
    expect(samples.every(({ sameRow }) => sameRow)).toBe(true)
    expect(
      samples.every(({ firstTop }) => Math.abs(firstTop - initialTop) < 1),
    ).toBe(true)
    expect(
      samples.every(
        ({ scrollTop }) => Math.abs(scrollTop - initial.scrollTop) < 1,
      ),
    ).toBe(true)
    expect(heightStyle).toBe('')
  }
})

test('the final page grows without briefly losing the load-more footer height', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions')
  for (const [groupKey, beforeFinal] of [
    ['pinned', 25],
    ['a', 124],
  ] as const) {
    const branch = page.locator(`[data-session-folder="${groupKey}"]`)
    const button = page.locator(`[data-page-footer="${groupKey}"] button`)
    for (
      let count = groupKey === 'a' ? 4 : 5;
      count < beforeFinal;
      count += 20
    ) {
      await button.click()
      await expect
        .poll(async () => (await loadedPages(page))[groupKey])
        .toBe(count + 20)
      await expect(button).toBeEnabled()
    }
    const { samples } = await samplePageExpansion(page, groupKey)
    const initial = samples[0]!.sectionHeight
    expect(samples.at(-1)!.sectionHeight).toBeGreaterThan(initial)
    expect(
      Math.min(...samples.map(({ sectionHeight }) => sectionHeight)),
    ).toBeGreaterThanOrEqual(initial - 1)
    await expect(button).toHaveCount(0)
    await expect(branch.getByText('No matching sessions')).toHaveCount(0)
  }
})

test('reduced motion skips the page reveal and collapsing cancels it before unloading', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?fixture=session-folders&manySessions')
  const { samples } = await samplePageExpansion(page, 'a')
  expect(samples.at(-1)!.height).toBeGreaterThan(samples[0]!.height)
  expect(samples.every(({ animations }) => animations === 0)).toBe(true)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.reload()
  const content = page.locator('[data-session-page="a"]')
  const canceled = await content.evaluate(async (element) => {
    const surface = element
      .closest('[data-session-folder]')!
      .querySelector<HTMLElement>(':scope > [data-slot="collapsible-content"]')!
    element
      .querySelector<HTMLButtonElement>(
        `[data-page-footer="${element.getAttribute('data-session-page')}"] button`,
      )!
      .click()
    const start = performance.now()
    while (
      !surface.getAnimations().length &&
      performance.now() - start < 1000
    ) {
      await new Promise(requestAnimationFrame)
    }
    const started = surface.getAnimations().length === 1
    const reveal = surface.getAnimations()[0]!
    element
      .closest('[data-session-folder="a"]')!
      .querySelector<HTMLButtonElement>('button[aria-expanded]')!
      .click()
    await new Promise(requestAnimationFrame)
    return {
      started,
      canceled: reveal.playState === 'idle',
    }
  })
  expect(canceled).toEqual({ started: true, canceled: true })
  await expect.poll(async () => (await loadedPages(page)).a).toBeUndefined()
  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(4)
})

test('sidebar edges and empty space do not highlight or move sessions', async ({
  page,
}) => {
  const source = page.getByRole('button', {
    name: 'Corvori chat',
    exact: false,
  })
  const sidebar = page.getByTestId('sidebar')
  const highlights = sidebar.locator('[class~="bg-primary/15"]')
  await dragTo(
    page,
    source,
    page.getByRole('separator', { name: 'Sessions without a folder' }),
  )
  await expect(highlights).toHaveCount(1)
  const bounds = (await sidebar.boundingBox())!
  const row = (await source.boundingBox())!
  for (const x of [bounds.x + 2, bounds.x + bounds.width - 2]) {
    await page.mouse.move(x, row.y + row.height / 2, { steps: 5 })
    await expect(highlights).toHaveCount(0)
  }
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 5) // prettier-ignore
  await expect(highlights).toHaveCount(0)
  await page.mouse.up()
  await expect(
    page.locator('[data-session-page="b"]').getByRole('button', {
      name: 'Corvori chat',
      exact: false,
    }),
  ).toBeVisible()
})

test('starting a drag finishes a page reveal before choosing a drop target', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions')
  const content = page.locator('[data-session-page="a"]')
  const source = content.getByRole('button', {
    name: 'Portfolio chat',
    exact: false,
  })
  await source.scrollIntoViewIfNeeded()
  await source.focus()
  const started = await content.evaluate(async (element) => {
    const surface = element
      .closest('[data-session-folder]')!
      .querySelector<HTMLElement>(':scope > [data-slot="collapsible-content"]')!
    element
      .querySelector<HTMLButtonElement>(
        `[data-page-footer="${element.getAttribute('data-session-page')}"] button`,
      )!
      .click()
    const start = performance.now()
    while (
      !surface.getAnimations().length &&
      performance.now() - start < 1000
    ) {
      await new Promise(requestAnimationFrame)
    }
    return surface.getAnimations().length === 1
  })
  expect(started).toBe(true)
  await page.keyboard.press('Space')
  await expect(content).toHaveCSS(
    'height',
    await content.evaluate((element) => `${element.scrollHeight}px`),
  )
  expect(
    await content.evaluate(
      (element) =>
        element
          .closest('[data-session-folder]')!
          .querySelector(':scope > [data-slot="collapsible-content"]')!
          .getAnimations().length,
    ),
  ).toBe(0)
  await page.keyboard.press('Escape')
  await expect(source).toBeFocused()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(24)
})

test('unfiled drop highlights stay continuous across the separator and sessions', async ({
  page,
}) => {
  await drag(
    page,
    page.getByRole('button', { name: 'Portfolio chat', exact: false }),
    page.getByRole('separator', { name: 'Sessions without a folder' }),
  )
  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBeUndefined()
  const unfiledSession = page.getByRole('button', {
    name: 'Portfolio chat',
    exact: false,
  })
  await expect(unfiledSession).toBeVisible()
  await dragTo(
    page,
    page.getByRole('button', { name: 'Corvori chat', exact: false }),
    unfiledSession,
  )
  const highlights = page
    .getByTestId('sidebar')
    .locator('[class~="bg-primary/15"]')
  await expect(highlights).toHaveCount(2)
  const bounds = await highlights.evaluateAll((elements) =>
    elements.map((element) => {
      const { top, bottom } = element.getBoundingClientRect()
      return { top, bottom }
    }),
  )
  await page.screenshot({ path: '/tmp/corvori-unfiled-drop.png' })
  expect(Math.abs(bounds[0]!.bottom - bounds[1]!.top)).toBeLessThan(1)
  await page.mouse.up()
  await folder(page, 'Corvori').click()
  await expect(page.getByText('Corvori chat', { exact: true })).toBeVisible()
})

test('closing unloads the branch after animating and reopening resets pagination', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions')
  const branch = page.locator('[data-session-folder="a"]')
  const loadMore = branch.getByRole('button', { name: 'Load more' }).last()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(4)
  await loadMore.click()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(24)
  // All loaded rows remain mounted even when below the scroll viewport.
  await expect(branch.getByText(/^a session /)).toHaveCount(23)
  await expect(loadMore).toHaveCSS('justify-content', 'flex-start')
  await expect(loadMore).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await folder(page, 'Portfolio').click()
  const content = branch.locator(':scope > [data-slot="collapsible-content"]')
  await expect(content).toHaveAttribute('inert', '')
  await expect.poll(async () => (await loadedPages(page)).a).toBeUndefined()
  await expect.poll(async () => (await loadedPages(page)).n).toBeUndefined()
  await expect(branch.getByText(/^a session /)).toHaveCount(0)
  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(4)
  await expect.poll(async () => (await loadedPages(page)).n).toBe(5)
  await expect(branch.getByText(/^a session /)).toHaveCount(3)
})

test('unfiled sessions start at ten and folder loading feedback stays local', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions&slowSessions')
  const sidebar = page.getByTestId('sidebar')
  const resolve = page.getByRole('button', { name: 'Resolve session queries' })
  await expect.poll(async () => (await loadedPages(page)).ungrouped).toBe(0)
  await expect(
    page.locator('[data-session-page="ungrouped"] > [role="status"]'),
  ).toHaveCount(0)
  await resolve.click()
  await expect
    .poll(() => loadedPages(page))
    .toEqual({ pinned: 5, a: 4, n: 5, b: 5, ungrouped: 10 })

  const loadMore = sidebar.getByRole('button', { name: 'Load more' }).last()
  await loadMore.click()
  await expect(loadMore).toBeDisabled()
  await expect(
    page.locator('[data-session-page="ungrouped"] > [role="status"]'),
  ).toHaveCount(0)
  await expect(sidebar.getByText('No matching sessions')).toHaveCount(0)
  await resolve.click()
  await expect.poll(async () => (await loadedPages(page)).ungrouped).toBe(30)
  await expect(loadMore).toBeEnabled()

  const search = page.getByRole('textbox', { name: 'Search sessions' })
  await search.fill('session')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(0)
  await resolve.click()
  await expect.poll(async () => (await loadedPages(page)).search).toBe(20)
  await search.fill('no matching session')
  await expect.poll(async () => (await loadedPages(page)).search).toBe(0)
  await resolve.click()
  await expect(sidebar.getByText('No matching sessions')).toBeVisible()
})

test('reversing a collapse keeps content and pagination until a completed collapse', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions')
  const branch = page.locator('[data-session-folder="a"]')
  await branch.getByRole('button', { name: 'Load more' }).last().click()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(24)
  await folder(page, 'Portfolio').evaluate((button) =>
    (button as HTMLButtonElement).click(),
  )
  await folder(page, 'Portfolio').evaluate((button) =>
    (button as HTMLButtonElement).click(),
  )
  await expect(folder(page, 'Portfolio')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect.poll(async () => (await loadedPages(page)).a).toBe(24)
})

test('reduced motion and subtree collapse unload descendants but leave unfiled sessions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?fixture=session-folders&manySessions')
  await expect
    .poll(async () => Object.keys(await loadedPages(page)).length)
    .toBe(5)
  const collapse = page.getByRole('button', {
    name: 'Collapse Portfolio and subfolders',
    exact: true,
  })
  await expect(collapse).toBeVisible()
  await collapse.click()
  await expect(collapse).toHaveCount(0)
  await expect(folder(page, 'Portfolio')).toBeFocused()
  await expect.poll(async () => (await loadedPages(page)).a).toBeUndefined()
  await expect.poll(async () => (await loadedPages(page)).n).toBeUndefined()
  await expect.poll(async () => (await loadedPages(page)).ungrouped).toBe(10)
  await folder(page, 'Portfolio').click()
  await expect.poll(async () => (await loadedPages(page)).a).toBe(4)
  await expect(folder(page, 'Design')).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await loadedPages(page)).n).toBeUndefined()
})

test('folder contents animate together before unmounting', async ({ page }) => {
  const branch = page.locator('[data-session-folder="a"]')
  await expect(
    branch.getByText('Portfolio chat', { exact: true }),
  ).toBeVisible()
  const heights = await branch.evaluate(async (element) => {
    const content = element.querySelector<HTMLElement>(
      ':scope > [data-slot="collapsible-content"]',
    )!
    const button = element.querySelector<HTMLButtonElement>(
      'button[aria-expanded]',
    )!
    const samples = [content.getBoundingClientRect().height]
    button.click()
    const start = performance.now()
    while (performance.now() - start < 300) {
      await new Promise(requestAnimationFrame)
      samples.push(content.getBoundingClientRect().height)
    }
    return samples
  })
  expect(heights.at(-1)).toBe(0)
  expect(heights.some((height) => height > 0 && height < heights[0]! - 1)).toBe(
    true,
  )
  await expect(branch.getByText('Portfolio chat', { exact: true })).toHaveCount(
    0,
  )
})

test('a few hundred loaded sessions collapse and reset when reopened individually', async ({
  page,
}) => {
  await page.goto('/?fixture=session-folders&manySessions')
  await expect
    .poll(async () => Object.keys(await loadedPages(page)).length)
    .toBe(5)
  for (const id of ['n', 'a', 'b', 'pinned']) {
    const branch = page.locator(`[data-session-folder="${id}"]`)
    for (let count = 0; count < 3; count++) {
      const button = branch.getByRole('button', { name: 'Load more' }).last()
      if (await button.count()) {
        await button.click()
        const expected = Math.min(
          (id === 'a' ? 4 : 5) + (count + 1) * 20,
          id === 'pinned' ? 30 : 126,
        )
        await expect
          .poll(async () => (await loadedPages(page))[id])
          .toBe(expected)
      }
    }
  }
  const sidebar = page.getByTestId('sidebar')
  for (let count = 0; count < 3; count++) {
    await sidebar.getByRole('button', { name: 'Load more' }).last().click()
  }
  await expect
    .poll(async () =>
      Object.values(await loadedPages(page)).reduce(
        (sum, count) => sum + count,
        0,
      ),
    )
    .toBe(294)
  const collapse = page.getByRole('button', { name: 'Collapse all folders' })
  await expect(collapse).toBeEnabled()
  await collapse.click()
  await expect(collapse).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Session list options' }),
  ).toBeFocused()
  await expect.poll(() => loadedPages(page)).toEqual({ ungrouped: 70 })

  await folder(page, 'Pinned').click()
  await expect(collapse).toBeEnabled()
  await folder(page, 'Pinned').click()
  await expect(collapse).toHaveCount(0)
  await folder(page, 'Portfolio').click()
  await expect(collapse).toBeEnabled()
  await expect(folder(page, 'Design')).toHaveAttribute('aria-expanded', 'false')
  for (const name of ['Design', 'Pinned', 'Corvori']) {
    await folder(page, name).click()
  }
  await expect
    .poll(() => loadedPages(page))
    .toEqual({ ungrouped: 70, pinned: 5, a: 4, n: 5, b: 5 })
})
