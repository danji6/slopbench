import { expect, test } from '@playwright/test'
import { recordPaginationFrames } from '~/tests/browser/pagination-frames'

for (const restored of [false, true]) {
  test(`holds the original text in every frame between page responses (restored=${restored})`, async ({
    page,
  }) => {
    await page.goto('/?fixture=message-pagination&text&slow')
    const text = page.getByText('Original visible text before loading', {
      exact: true,
    })
    await expect(text).toBeVisible()
    if (restored) {
      await page.evaluate(() =>
        window.dispatchEvent(new Event('anchor-pagination')),
      )
      await expect(page.locator('main')).toHaveAttribute(
        'data-window-requests',
        '2',
      )
      await page.evaluate(() =>
        window.dispatchEvent(new Event('resolve-pagination-page')),
      )
      await expect
        .poll(() => text.evaluate((el) => el.getBoundingClientRect().top))
        .toBeGreaterThan(64)
    }
    const originalTop = await text.evaluate(
      (el) => el.getBoundingClientRect().top,
    )
    const selector = await text.evaluate((el) => {
      const key = el.closest<HTMLElement>('[data-row-key]')!.dataset.rowKey!
      return `[data-row-key="${CSS.escape(key)}"] article`
    })
    const stopRecording = await recordPaginationFrames(page, selector)
    await page
      .getByRole('button', { name: 'Load older messages', exact: true })
      .click()
    await expect(page.locator('main')).toHaveAttribute(
      'data-window-requests',
      restored ? '3' : '2',
    )
    await page.evaluate(() =>
      window.dispatchEvent(new Event('resolve-pagination-page')),
    )
    if (!restored)
      await expect(page.locator('main')).toHaveAttribute(
        'data-window-requests',
        '3',
      )
    // Leave the next query pending while collecting actual rendered frames.
    await page.evaluate(async () => {
      for (let frame = 0; frame < 6; frame++)
        await new Promise(requestAnimationFrame)
      window.dispatchEvent(new Event('resolve-pagination-page'))
    })
    await expect(page.locator('main')).toHaveAttribute(
      'data-pagination-loading',
      'false',
    )
    const samples = await stopRecording()
    expect(samples.length).toBeGreaterThan(6)
    expect(
      Math.max(
        ...samples.map(({ top }) =>
          top === null ? Infinity : Math.abs(top - originalTop),
        ),
      ),
    ).toBeLessThanOrEqual(1)
  })
}

for (const scenario of ['text', 'grouped']) {
  test(`preserves existing text when older content changes its header (${scenario})`, async ({
    page,
  }) => {
    await page.goto(`/?fixture=message-pagination&${scenario}`)
    const text = page.getByText('Original visible text before loading', {
      exact: true,
    })
    await expect(text).toBeVisible()
    const top = await text.evaluate((el) => el.getBoundingClientRect().top)
    await page
      .getByRole('button', { name: 'Load older messages', exact: true })
      .click()
    await expect(page.locator('main')).toHaveAttribute(
      'data-pagination-loading',
      'false',
    )
    await expect(
      page.getByText('Older visible message', { exact: true }),
    ).toBeAttached()
    await expect
      .poll(() => text.evaluate((el) => el.getBoundingClientRect().top))
      .toBeCloseTo(top, 0)
  })
}

test('preserves the offset of text partly obscured by the navigation inset', async ({
  page,
}) => {
  await page.goto('/?fixture=message-pagination&text')
  await expect(page.locator('main')).toHaveAttribute(
    'data-position-ready',
    'true',
  )
  const text = page.getByText('Original visible text before loading', {
    exact: true,
  })
  await expect(text).toBeVisible()
  await text.evaluate((el) =>
    window.scrollBy({
      top: el.getBoundingClientRect().top - 32,
    }),
  )
  await expect
    .poll(() => text.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(32, 0)
  // Trigger the same handler without Playwright scrolling the button into view.
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .evaluate((el) => {
      if (el instanceof HTMLButtonElement) el.click()
    })
  await expect(
    page.getByText('Older visible message', { exact: true }),
  ).toBeAttached()
  await expect(page.locator('main')).toHaveAttribute(
    'data-pagination-loading',
    'false',
  )
  await expect
    .poll(() => text.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(32, 0)
})

test('one click skips collapsed pages and retains the original work position', async ({
  page,
}) => {
  await page.goto('/?fixture=message-pagination')
  await expect(page.locator('main')).toHaveAttribute(
    'data-position-ready',
    'true',
  )
  const anchor = page.getByRole('button', { name: /^Read \d+ files$/ })
  await expect(anchor).toBeVisible()
  const top = await anchor.evaluate((el) =>
    Math.round(el.getBoundingClientRect().top),
  )
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click()
  await expect(
    page.getByText('Older visible message', { exact: true }),
  ).toBeAttached()
  await expect(page.locator('main')).toHaveAttribute(
    'data-pagination-loading',
    'false',
  )
  expect(
    Number(await page.locator('main').getAttribute('data-window-requests')),
  ).toBe(3)
  await expect
    .poll(() =>
      anchor.evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBe(top)
})

test('slides across collapsed groups and positions the first retained row when the original is evicted', async ({
  page,
}) => {
  await page.goto('/?fixture=message-pagination&long')
  await expect(page.locator('[data-row-key="h:m12"]')).toBeVisible()
  const stopRecording = await recordPaginationFrames(page)
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click()
  await expect(
    page.getByText('Older visible message', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('main')).toHaveAttribute(
    'data-pagination-loading',
    'false',
  )
  await expect(page.locator('[data-row-key="h:m12"]')).toHaveCount(0)
  await expect
    .poll(() =>
      page
        .locator('[data-row-key="h:m0"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBe(64)
  expect(
    Number(await page.locator('main').getAttribute('data-window-requests')),
  ).toBeGreaterThan(4)
  const frames = await stopRecording()
  expect(frames.length).toBeGreaterThan(0)
  expect(frames.every((frame) => frame.visibleRows > 0)).toBe(true)
})

test('cancels viewport compensation when the user interrupts a pending page', async ({
  page,
}) => {
  await page.goto('/?fixture=message-pagination&text&slow')
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-position-ready', 'true')
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click()
  await expect(main).toHaveAttribute('data-window-requests', '2')
  await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 80 }))
    window.scrollTo({ top: 80 })
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(80)
  await page.evaluate(() =>
    window.dispatchEvent(new Event('resolve-pagination')),
  )
  await expect(main).toHaveAttribute('data-pagination-loading', 'false')
  await expect(main).toHaveAttribute('data-window-requests', '2')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(80)
})

test('Page Up at the older edge continues across collapsed pages', async ({
  page,
}) => {
  await page.goto('/?fixture=message-pagination&long')
  const load = page.getByRole('button', {
    name: 'Load older messages',
    exact: true,
  })
  await load.press('PageUp')
  await expect(
    page.getByText('Older visible message', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('main')).toHaveAttribute(
    'data-pagination-loading',
    'false',
  )
  await expect
    .poll(() =>
      page
        .locator('[data-row-key="h:m0"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBe(64)
})

test('keeps the older button busy until deferred loading and continuation finish', async ({
  page,
}) => {
  await page.goto('/?fixture=message-pagination&slow')
  const load = page.getByRole('button', {
    name: 'Load older messages',
    exact: true,
  })
  await load.click()
  await expect(load).toBeDisabled()
  await expect(load).toHaveAttribute('aria-busy', 'true')
  await page.evaluate(() =>
    window.dispatchEvent(new Event('resolve-pagination')),
  )
  await expect(
    page.getByText('Older visible message', { exact: true }),
  ).toBeVisible()
  await expect(load).toBeEnabled()
  await expect(load).toHaveAttribute('aria-busy', 'false')
})
