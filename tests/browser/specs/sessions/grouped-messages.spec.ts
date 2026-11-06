import { expect, test } from '@playwright/test'

for (const grouped of [true, false]) {
  test(`shell commands and reports share shell groups (grouped=${grouped})`, async ({
    page,
  }) => {
    await page.goto(
      `/?fixture=notes&id=notes&shellReports${grouped ? '' : '&ungrouped'}`,
    )
    await expect(page.locator('[data-slot="message-header"]')).toHaveCount(
      grouped ? 2 : 4,
    )
    const report = page.locator(
      '[data-slot="message-row"][data-message-id="shell2"]',
    )
    await expect(
      report.locator('[data-slot="shell-report-block"]'),
    ).toHaveCount(0)
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toHaveCount(grouped ? 2 : 3)
    await expect(work.first()).toContainText('Ran 2 commands')
    for (const block of await work.all()) await block.click()
    await expect(report.first()).toHaveAttribute('data-role', 'assistant')

    const groups = page.locator('[data-slot="shell-group"]')
    await expect(groups).toHaveCount(4)
    await expect(groups.nth(0)).toContainText('Ran 1 command')
    await expect(groups.nth(1)).toContainText('Ran 2 commands')
    await expect(groups.nth(2)).toContainText('Ran 1 command')
    await expect(groups.nth(3)).toContainText('Read 1 command output')
    await expect(groups.nth(0)).toContainText('user output')
    await expect(groups.nth(2).getByText('Lint passed')).toBeHidden()
    await groups.nth(2).getByRole('button').click()
    await expect(groups.nth(2).getByText('Lint passed')).toBeVisible()
    if (grouped) {
      await expect
        .poll(async () => {
          const reportBox = await groups.nth(2).boundingBox()
          const progressBox = await page
            .getByText('Agent progress', { exact: true })
            .boundingBox()
          return reportBox && progressBox
            ? progressBox.y - reportBox.y - reportBox.height
            : Infinity
        })
        .toBeLessThanOrEqual(24)
    }
    await work.first().click()
    if (grouped) {
      await expect(
        report.locator('[data-slot="shell-report-block"]'),
      ).toHaveCount(0)
      await expect(work.first()).toContainText('Ran 2 commands')
      await page.getByRole('button', { name: 'Seek report' }).click()
      await expect(work.first()).toHaveAttribute('aria-expanded', 'true')
      await expect(
        report.locator('[data-slot="shell-report-block"]'),
      ).toBeVisible()
    }
    await expect(
      page.locator(
        '[data-slot="shell-block"]:not([data-slot="shell-group"] *)',
      ),
    ).toHaveCount(0)
    if (grouped) {
      await expect(page.locator('[data-slow="message-footer"]')).toHaveCount(1)
      await expect(page.locator('[data-slow="message-footer"]')).toContainText(
        '146.0s',
      )
    }
  })
}

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
