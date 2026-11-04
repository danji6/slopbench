import { expect, test } from '@playwright/test'

for (const emptyChanges of [false, true]) {
  test(`completed grouped messages leave no blank space between collapsed work summaries (emptyChanges=${emptyChanges})`, async ({
    page,
  }) => {
    await page.goto(
      `/?fixture=notes&id=notes&groupedWork${emptyChanges ? '&emptyChanges' : ''}`,
    )
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toHaveCount(2)
    await expect
      .poll(async () => {
        const first = await work.nth(0).boundingBox()
        const second = await work.nth(1).boundingBox()
        return first && second ? second.y - first.y - first.height : Infinity
      })
      .toBeLessThanOrEqual(1)
  })
}

test('releases footer height when its duration disappears', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&groupedWork')
  const footer = page.locator('[data-row-kind="footer"]')
  await expect(footer.locator('[data-slow="message-footer"]')).toBeVisible()
  await expect
    .poll(async () => (await footer.boundingBox())?.height ?? 0)
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Hide duration' }).click()
  await expect(footer.locator('[data-slow="message-footer"]')).toHaveCount(0)
  await expect
    .poll(async () => (await footer.boundingBox())?.height ?? Infinity)
    .toBeLessThanOrEqual(1)
})

for (const finishOpening of [true, false]) {
  test(`collapsing work at the tail preserves position without bouncing (finishOpening=${finishOpening})`, async ({
    page,
  }) => {
    await page.goto('/?fixture=notes&id=notes&tailWork')
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toBeVisible()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let last = -1
          let stable = 0
          const tick = () => {
            const height = document.documentElement.scrollHeight
            window.scrollTo(0, height)
            stable = height === last ? stable + 1 : 0
            last = height
            if (stable >= 3) resolve()
            else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
    )
    await expect(work).toBeInViewport({ ratio: 1 })
    const originalY = await page.evaluate(() => window.scrollY)
    await work.evaluate((button) => (button as HTMLButtonElement).click())
    await expect(work).toHaveAttribute('aria-expanded', 'true')
    if (finishOpening) {
      await expect(
        page.locator('[data-slot="virtualized-row-transition"][data-state]'),
      ).toHaveCount(0)
    }

    const frames = await work.evaluate(
      (button) =>
        new Promise<Array<{ y: number; height: number }>>((resolve) => {
          const frames: Array<{ y: number; height: number }> = []
          const tick = () => {
            frames.push({
              y: window.scrollY,
              height: document.documentElement.scrollHeight,
            })
            if (frames.length < 45) requestAnimationFrame(tick)
            else resolve(frames)
          }
          button.addEventListener('click', () => requestAnimationFrame(tick), {
            once: true,
          })
          ;(button as HTMLButtonElement).click()
        }),
    )
    await expect(work).toHaveAttribute('aria-expanded', 'false')
    expect(Math.abs(frames.at(-1)!.y - originalY)).toBeLessThanOrEqual(1)
    expect(
      Math.max(...frames.map((frame) => Math.abs(frame.y - originalY))),
    ).toBeLessThanOrEqual(1)
  })
}
