import { expect, test } from '@playwright/test'

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
