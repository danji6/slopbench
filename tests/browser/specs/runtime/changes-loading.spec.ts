import { expect, test } from '@playwright/test'

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
    await expect(added.locator('span')).toHaveCount(0)
    const surface = panel.locator('[data-slot="code-surface"]')
    const before = (await surface.boundingBox())!.height
    resumeWorker()
    await expect(added.locator('span')).not.toHaveCount(0)
    expect((await surface.boundingBox())!.height).toBeCloseTo(before, 0)
  } finally {
    resumeWorker()
  }
})
