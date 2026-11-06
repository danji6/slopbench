import { expect, test } from '@playwright/test'

for (const highlighting of ['on', 'off']) {
  test(`keeps gutters fixed while scrolling code (highlighting=${highlighting})`, async ({
    page,
  }) => {
    await page.goto(`/?fixture=code&highlighting=${highlighting}`)
    for (const kind of ['numbered', 'diff']) {
      const block = page.getByTestId(kind)
      const surface = block.locator('[data-slot="code-surface"]')
      const line = block.locator('.line').first()
      const gutter = line.locator('.code-gutter')
      await expect(gutter).toBeVisible()
      if (highlighting === 'on') {
        await expect(line.locator('span[style]')).not.toHaveCount(0)
      }
      const gutterBefore = (await gutter.boundingBox())!
      const lineBefore = (await line.boundingBox())!
      await surface.evaluate((element) => {
        element.scrollLeft = 180
      })
      await expect
        .poll(async () => await surface.evaluate((el) => el.scrollLeft))
        .toBe(180)
      const gutterAfter = (await gutter.boundingBox())!
      expect(gutterAfter.x).toBeCloseTo(gutterBefore.x, 0)
      expect((await line.boundingBox())!.x).toBeCloseTo(lineBefore.x - 180, 0)
      const surfaceBox = (await surface.boundingBox())!
      const leadingPadding = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.classList.contains('code-gutter'),
        { x: surfaceBox.x + 2, y: gutterAfter.y + gutterAfter.height / 2 },
      )
      expect(leadingPadding).toBe(true)
      expect(
        await gutter.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/)
      await surface.evaluate((element) => {
        element.scrollTop = 36
      })
      await expect
        .poll(async () => (await gutter.boundingBox())!.y)
        .toBeCloseTo(gutterAfter.y - 36, 0)
    }
    const diff = page.getByTestId('diff')
    await expect(diff.locator('.diff-remove .diff-change')).toHaveText('dark')
    await expect(diff.locator('.diff-add .diff-change')).toHaveText('light')
    for (const kind of ['diff', 'wrapped-diff']) {
      const block = page.getByTestId(kind)
      const geometry = await block.evaluate((el) => {
        const surface = el.querySelector<HTMLElement>(
          '[data-slot="code-surface"]',
        )!
        const code = surface.querySelector('code')!.getBoundingClientRect()
        const lines = [...surface.querySelectorAll('.line')].map((line) =>
          line.getBoundingClientRect(),
        )
        const surfaceBox = surface.getBoundingClientRect()
        return {
          top:
            lines[0].top +
            surface.scrollTop -
            surfaceBox.top -
            surface.clientTop,
          bottom:
            surface.scrollHeight -
            (lines.at(-1)!.bottom -
              surfaceBox.top -
              surface.clientTop +
              surface.scrollTop),
          edges: lines.map((line) => Math.abs(line.right - code.right)),
        }
      })
      expect(Math.abs(geometry.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.bottom)).toBeLessThanOrEqual(1)
      expect(Math.max(...geometry.edges)).toBeLessThanOrEqual(1)
    }

    for (const kind of ['wrapped', 'wrapped-diff']) {
      const wrapped = page.getByTestId(kind)
      const geometry = await wrapped
        .locator('[data-slot="code-surface"]')
        .evaluate((el) => ({ width: el.clientWidth, content: el.scrollWidth }))
      expect(geometry.content).toBe(geometry.width)
      const firstLine = wrapped.locator('.line').first()
      const row = (await firstLine.boundingBox())!
      const gutter = (await firstLine.locator('.code-gutter').boundingBox())!
      const lineHeight = await firstLine.evaluate((el) =>
        parseFloat(getComputedStyle(el).lineHeight),
      )
      expect(row.height).toBeGreaterThan(lineHeight * 2)
      expect(gutter.y).toBeCloseTo(row.y, 0)
      expect(gutter.height).toBeCloseTo(row.height, 0)
      const next = (await wrapped.locator('.line').nth(1).boundingBox())!
      expect(next.y).toBeCloseTo(gutter.y + gutter.height, 0)
    }
  })
}
