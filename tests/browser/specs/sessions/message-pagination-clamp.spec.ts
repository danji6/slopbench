import { expect, test } from '@playwright/test'
import { APP_ID } from '@cv/core/const'
import { recordPaginationFrames } from '~/tests/browser/pagination-frames'

for (const full of [false, true]) {
  test(`keeps the restored viewport populated when older history ${full ? 'exceeds' : 'fits'} the window budget`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1343 })
    await page.goto(
      `/?fixture=message-pagination&persist&clamped${full ? '&full' : ''}`,
    )
    const main = page.locator('main')
    await expect(main).toHaveAttribute('data-position-ready', 'true')
    await page.addInitScript(
      (appId) =>
        localStorage.setItem(
          `${appId}-scroll-positions`,
          JSON.stringify({
            pagination: {
              anchorId: 'm8',
              creationTime: 8,
              segmentIndex: 0,
              rowAddress: {
                kind: 'work',
                segmentIndex: 0,
                toolCallId: 'call8:0',
              },
              contentOffset: true,
              offset: 0,
              following: false,
              updatedAt: Date.now(),
            },
          }),
        ),
      APP_ID,
    )
    await page.reload()
    await expect(main).toHaveAttribute('data-position-ready', 'true')
    const work = page.locator('[data-work-anchor="call8:0"]')
    await expect
      .poll(() => work.evaluate((el) => el.getBoundingClientRect().top))
      .toBeCloseTo(64, 0)
    const visibleText = page.getByText('History 9', { exact: true })
    await expect(visibleText).toBeVisible()
    const originalTop = await visibleText.evaluate(
      (el) => el.getBoundingClientRect().top,
    )
    const stop = await recordPaginationFrames(
      page,
      '[data-message-id="m9"] article',
    )
    await page
      .getByRole('button', { name: 'Load older messages', exact: true })
      .evaluate((el) => (el as HTMLButtonElement).click())
    await expect(main).toHaveAttribute('data-pagination-loading', 'false')
    await expect(main).toHaveAttribute('data-window-positioning', 'false')
    const frames = await stop()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(({ visibleRows }) => visibleRows > 0)).toBe(true)
    expect(
      frames.every(({ top }) => top !== null && top > 64 && top < 1343),
    ).toBe(true)
    await expect
      .poll(() => work.evaluate((el) => el.getBoundingClientRect().top))
      .toBeCloseTo(64, 0)
    await expect(visibleText).toBeVisible()
    expect(
      await visibleText.evaluate((el) => el.getBoundingClientRect().top),
    ).toBeCloseTo(originalTop, 0)
    await expect(
      page.getByRole('button', { name: 'Load newer messages', exact: true }),
    ).toHaveCount(0)
    if (full) {
      const stopEviction = await recordPaginationFrames(
        page,
        '[data-work-anchor="call8:0"]',
      )
      await page
        .getByRole('button', { name: 'Load older messages', exact: true })
        .evaluate((el) => (el as HTMLButtonElement).click())
      await expect(main).toHaveAttribute('data-pagination-loading', 'false')
      await expect(main).toHaveAttribute('data-window-positioning', 'false')
      const evictionFrames = await stopEviction()
      expect(evictionFrames.length).toBeGreaterThan(0)
      expect(evictionFrames.every(({ visibleRows }) => visibleRows > 0)).toBe(
        true,
      )
      // Eviction may remove visible content; the viewport must stay in the real transcript.
      await expect(
        page.getByRole('button', { name: 'Load newer messages', exact: true }),
      ).toBeVisible()
      const end = await work.evaluate((el) => el.getBoundingClientRect().bottom)
      expect(end).toBeGreaterThan(64)
      expect(end).toBeLessThan(1343)
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollHeight -
              window.innerHeight -
              window.scrollY,
          ),
        )
        .toBeLessThanOrEqual(1)
    } else {
      await expect(
        page.getByRole('button', { name: 'Load older messages', exact: true }),
      ).toHaveCount(0)
    }
  })
}
