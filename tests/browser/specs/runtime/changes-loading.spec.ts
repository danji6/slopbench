import { type Locator, expect, test } from '@playwright/test'

for (const side of ['top', 'bottom']) {
  test(`positions a slow hover diff on the ${side} using its loaded size`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    let resolveDiff!: () => void
    const diffReady = new Promise<void>((resolve) => {
      resolveDiff = resolve
    })
    await page.route('**/diff/file-1.patch', async (route) => {
      await diffReady
      await route.fulfill({
        contentType: 'text/plain',
        body: `--- file.ts\n+++ file.ts\n@@ -1 +1,120 @@\n-before\n${'+after\n'.repeat(120)}`,
      })
    })
    try {
      await page.goto('/?fixture=changes&networkDiff')
      if (side === 'top') {
        await page.addStyleTag({ content: 'main { margin-top: 450px; }' })
      }
      const first = page.getByRole('button', { name: /src\/file-1.ts/ })
      const request = page.waitForRequest('**/diff/file-1.patch')
      await first.hover()
      await request
      const trigger = page.locator('[data-slot="popover-trigger"]').first()
      await expect(trigger).toHaveAttribute('data-popup-open', '')
      const preview = page.getByRole('dialog')
      await expect(preview).toHaveCount(0)

      resolveDiff()
      await expect(preview).toBeVisible()
      await expect(preview).toHaveAttribute('data-side', side)
      await expect(preview.locator('.diff-add').first()).toContainText('after')
      const popup = (await preview.boundingBox())!
      const anchor = (await first.boundingBox())!
      if (side === 'top') {
        expect(popup.y + popup.height).toBeLessThanOrEqual(anchor.y)
      } else {
        expect(popup.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
      }
    } finally {
      resolveDiff()
    }
  })
}

test('cancels a pending hover diff when the pointer leaves the file', async ({
  page,
}) => {
  await page.route('**/diff/file-1.patch', () => {})
  await page.goto('/?fixture=changes&networkDiff')
  const request = page.waitForRequest('**/diff/file-1.patch')
  await page.getByRole('button', { name: /src\/file-1.ts/ }).hover()
  await request
  const trigger = page.locator('[data-slot="popover-trigger"]').first()
  await expect(trigger).toHaveAttribute('data-popup-open', '')
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().endsWith('/diff/file-1.patch'),
  })
  await page.mouse.move(0, 0)
  await cancelled
  await expect(trigger).not.toHaveAttribute('data-popup-open', '')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

for (const width of [480, 1280]) {
  test(`reserves file-list space and retains loaded changes across remounts (width=${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/?fixture=changes&delayed')
    await page.getByRole('button', { name: 'Resolve changeSummary' }).click()
    const summary = page.getByRole('region', { name: 'Agent changes' })
    await expect(summary).toBeVisible()
    const loadingHeight = (await summary.boundingBox())!.height
    await page.getByRole('button', { name: 'Resolve changeFiles' }).click()
    await expect(page.getByRole('button', { name: /src\/file-/ })).toHaveCount(
      5,
    )
    const loadedHeight = (await summary.boundingBox())!.height
    expect(Math.abs(loadedHeight - loadingHeight)).toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: 'Unmount summary' }).click()
    await expect(summary).toHaveCount(0)
    const frames = await page
      .getByRole('button', { name: 'Remount summary' })
      .evaluate(
        (button) =>
          new Promise<Array<{ height: number; files: number }>>((resolve) => {
            const frames: Array<{ height: number; files: number }> = []
            const tick = () => {
              const summary = document.querySelector(
                '[aria-label="Agent changes"]',
              )
              frames.push({
                height: summary?.getBoundingClientRect().height ?? 0,
                files:
                  summary?.querySelectorAll('[data-slot="accordion-trigger"]')
                    .length ?? 0,
              })
              if (frames.length < 8) requestAnimationFrame(tick)
              else resolve(frames)
            }
            ;(button as HTMLButtonElement).click()
            requestAnimationFrame(tick)
          }),
      )
    expect(frames.every((frame) => frame.files === 5)).toBe(true)
    expect(
      Math.max(...frames.map((frame) => Math.abs(frame.height - loadedHeight))),
    ).toBeLessThanOrEqual(1)
  })
}

test('expands to newly loaded content smoothly and renders diff markers before syntax highlighting', async ({
  page,
}) => {
  let workerPaused = false
  let resumeWorker!: () => void
  const workerReady = new Promise<void>((resolve) => {
    resumeWorker = resolve
  })
  await page.route('**/shiki.worker-*.js', async (route) => {
    workerPaused = true
    await workerReady
    await route.continue()
  })
  try {
    await page.goto('/?fixture=changes')
    await expect(page.getByText('Changes made')).toBeVisible()
    const frames = await page.evaluate(
      () =>
        new Promise<Array<{ time: number; panel: number; content: number }>>(
          (resolve, reject) => {
            const frames: Array<{
              time: number
              panel: number
              content: number
            }> = []
            const start = performance.now()
            let settled = 0
            const sample = () => {
              const panel = document.querySelector(
                '[data-slot="accordion-content"]',
              )
              const height = panel?.getBoundingClientRect().height ?? 0
              const content =
                panel?.firstElementChild?.getBoundingClientRect().height ?? 0
              const time = performance.now() - start
              frames.push({ time, panel: height, content })
              settled =
                content > 100 && Math.abs(content - height) < 1
                  ? settled + 1
                  : 0
              if (settled >= 3) return resolve(frames)
              if (time > 3000)
                return reject(new Error('Accordion did not settle'))
              requestAnimationFrame(sample)
            }
            // Open without hovering first, so this exercises an uncached diff.
            document
              .querySelector<HTMLButtonElement>(
                '[data-slot="accordion-trigger"]',
              )!
              .click()
            requestAnimationFrame(sample)
          },
        ),
    )
    expect(
      frames.some(
        (frame) => frame.panel > 60 && frame.panel < frame.content - 10,
      ),
    ).toBe(true)
    const steps = frames
      .slice(1)
      .flatMap((frame, index) =>
        frame.time - frames[index].time < 60
          ? [frame.panel - frames[index].panel]
          : [],
      )
    expect(Math.max(...steps)).toBeLessThan(frames.at(-1)!.content / 2)
    await expect.poll(() => workerPaused).toBe(true)
    const panel = page.locator('[data-slot="accordion-content"]')
    const added = panel.locator('.shiki-diff .diff-add')
    await expect(added).toContainText('after file-1')
    expect((await added.getAttribute('data-gutter'))?.trim()).toBe('1 +')
    expect(
      await added.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/)
    await expect(added.locator('.diff-change')).toHaveText('after')
    await expect(added.locator('span[style]')).toHaveCount(0)
    const surface = panel.locator('[data-slot="code-surface"]')
    const before = (await surface.boundingBox())!.height
    resumeWorker()
    await expect(added.locator('span[style]')).not.toHaveCount(0)
    expect((await surface.boundingBox())!.height).toBeCloseTo(before, 0)
  } finally {
    resumeWorker()
  }
})

for (const delayedDiff of [false, true]) {
  test(`reveals an expanded file after its diff settles (delayed diff=${delayedDiff})`, async ({
    page,
  }) => {
    const height = 530
    await page.setViewportSize({ width: 1100, height })
    let resolveDiff!: () => void
    const diffReady = new Promise<void>((resolve) => {
      resolveDiff = resolve
    })
    await page.route('**/diff/file-1.patch', async (route) => {
      if (delayedDiff) await diffReady
      await route.fulfill({
        contentType: 'text/plain',
        body: `--- file.ts\n+++ file.ts\n@@ -1 +1,120 @@\n-before\n${'+after\n'.repeat(120)}`,
      })
    })
    try {
      await page.goto('/?fixture=changes&transcript&networkDiff')
      const first = page.getByRole('button', {
        name: 'src/file-1.ts',
        exact: true,
      })
      await expect(first).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollHeight -
              window.scrollY -
              window.innerHeight,
          ),
        )
        .toBeLessThan(2)
      // Place the file near the dock with enough transcript below it to scroll.
      const initial = (await first.boundingBox())!.y
      await page.mouse.move(10, height / 2)
      await page.mouse.wheel(0, initial - (height - 120))
      await expect
        .poll(() =>
          first.evaluate((button) => {
            const { left, top, width, height } = button.getBoundingClientRect()
            const hit = document.elementFromPoint(
              left + width / 2,
              top + height / 2,
            )
            return top > innerHeight - 145 && button.contains(hit)
          }),
        )
        .toBe(true)
      const before = (await first.boundingBox())!
      const x = before.x + before.width / 2
      const y = before.y + before.height / 2
      if (!delayedDiff) {
        await page.mouse.move(x, y)
        await expect(page.getByRole('dialog')).toBeVisible()
      }
      await page.mouse.click(x, y)
      if (delayedDiff) {
        await expect(
          page.getByRole('status').filter({ hasText: 'Loading diff' }),
        ).toBeVisible()
        const positions = await sampleFilePosition(first)
        expect(
          Math.max(...positions.map((top) => Math.abs(top - before.y))),
        ).toBeLessThanOrEqual(2)
        resolveDiff()
      }
      const panel = page.locator('[data-slot="accordion-content"]')
      await expect(panel.locator('.diff-add').first()).toBeVisible()
      await expect
        .poll(async () => {
          const box = await panel.boundingBox()
          return box ? box.y + box.height : Infinity
        })
        .toBeLessThanOrEqual(height - 80)
      const settled = (await sampleFilePosition(first)).at(-1)!
      expect(settled).toBeLessThan(before.y - 20)
      expect(settled).toBeGreaterThanOrEqual(64)
    } finally {
      resolveDiff()
    }
  })
}

/** Samples the viewport until virtual measurements and the accordion settle. */
function sampleFilePosition(trigger: Locator) {
  return trigger.evaluate(
    (trigger) =>
      new Promise<number[]>((resolve, reject) => {
        const positions: number[] = []
        const start = performance.now()
        let stable = 0
        let lastHeight = -1
        const sample = () => {
          const top = trigger.getBoundingClientRect().top
          const panel = document.querySelector(
            '[data-slot="accordion-content"]',
          )
          const height = panel?.getBoundingClientRect().height ?? 0
          const content =
            panel?.firstElementChild?.getBoundingClientRect().height ?? 0
          const documentHeight = document.documentElement.scrollHeight
          const unchanged =
            positions.at(-1) === top && lastHeight === documentHeight
          const settled = Math.abs(height - content) < 1
          stable = unchanged && settled ? stable + 1 : 0
          positions.push(top)
          lastHeight = documentHeight
          if (stable >= 8) return resolve(positions)
          if (performance.now() - start > 5000)
            return reject(new Error('Summary did not settle'))
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }),
  )
}
