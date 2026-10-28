import { expect, test } from '@playwright/test'
import { recordPaginationFrames } from '~/tests/browser/pagination-frames'

test('preserves a tall message when loading older from a refreshed middle window', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('scroll-debug', '1'))
  await page.goto('/?fixture=message-pagination&persist&text&middle')
  expect(
    await page.evaluate(() => Reflect.get(window, '__scrollDebug')),
  ).toBeUndefined()
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-position-ready', 'true')
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click()
  await expect(main).toHaveAttribute('data-pagination-loading', 'false')
  const text = page.getByText('Tall retained message', { exact: true })
  await text.evaluate((el) =>
    window.scrollBy({ top: el.getBoundingClientRect().top + 700 }),
  )
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  )
  await page.reload()
  await expect(main).toHaveAttribute('data-position-ready', 'true')
  await expect
    .poll(() => text.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(-700, 0)

  await expect(
    page.getByRole('button', { name: 'Load newer messages', exact: true }),
  ).toBeAttached()
  const selector = await text.evaluate(
    (el) =>
      `[data-row-key="${CSS.escape(el.closest<HTMLElement>('[data-row-key]')!.dataset.rowKey!)}"] article`,
  )
  const stop = await recordPaginationFrames(page, selector)
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click())
  await expect(main).toHaveAttribute('data-pagination-loading', 'false')
  const frames = await stop()
  expect(frames.length).toBeGreaterThan(0)
  expect(frames.every((frame) => frame.visibleRows > 0)).toBe(true)
  expect(
    Math.max(
      ...frames.map(({ top }) =>
        top === null ? Infinity : Math.abs(top + 700),
      ),
    ),
  ).toBeLessThanOrEqual(1)
  await expect
    .poll(() => text.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(-700, 0)
})

test('loads older pages after refreshing a saved collapsed-work position without blank or jumping frames', async ({
  page,
}) => {
  await page.goto('/?fixture=message-pagination&persist&text')
  expect(
    await page.evaluate(() => Reflect.get(window, '__scrollDebug')),
  ).toBeUndefined()
  const main = page.locator('main')
  await expect(main).toHaveAttribute('data-position-ready', 'true')
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .click()
  await expect(main).toHaveAttribute('data-pagination-loading', 'false')
  const work = page.locator('[data-work-anchor="call1:15"]')
  await expect(work).toBeVisible()
  await work.evaluate((el) =>
    window.scrollBy({ top: el.getBoundingClientRect().top - 64 }),
  )
  await expect
    .poll(() => work.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(64, 0)
  // pagehide saves synchronously, including when the debounce has not fired.
  const saved = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    const key = Object.keys(localStorage).find((key) =>
      key.endsWith('-scroll-positions'),
    )!
    return JSON.parse(localStorage.getItem(key)!).pagination
  })
  expect(saved.rowAddress).toEqual({
    kind: 'work',
    segmentIndex: 15,
    toolCallId: 'call1:15',
  })
  await page.reload()
  await expect(main).toHaveAttribute('data-position-ready', 'true')
  await expect(work).toBeVisible()
  await expect
    .poll(() => work.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(64, 0)

  const stopRecording = await recordPaginationFrames(
    page,
    '[data-work-anchor="call1:15"]',
  )
  // Keep the saved reading position; Playwright must not scroll the button first.
  await page
    .getByRole('button', { name: 'Load older messages', exact: true })
    .evaluate((el) => {
      if (el instanceof HTMLButtonElement) el.click()
    })
  await expect(main).toHaveAttribute('data-pagination-loading', 'false')
  await expect(
    page.getByRole('button', { name: 'Load newer messages', exact: true }),
  ).toHaveCount(0)
  await expect(main).toHaveAttribute('data-window-positioning', 'false')
  const samples = await stopRecording()
  expect(samples.length).toBeGreaterThan(0)
  expect(
    Math.max(
      ...samples.map(({ top }) =>
        top === null ? Infinity : Math.abs(top - 64),
      ),
    ),
  ).toBeLessThanOrEqual(1)
  expect(samples.every((frame) => frame.visibleRows > 0)).toBe(true)
  await expect(work).toBeVisible()
})
