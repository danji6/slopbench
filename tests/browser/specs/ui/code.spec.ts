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
    const wrapped = page.getByTestId('wrapped')
    const geometry = await wrapped
      .locator('[data-slot="code-surface"]')
      .evaluate((el) => ({ width: el.clientWidth, content: el.scrollWidth }))
    expect(geometry.content).toBe(geometry.width)
    const firstLine = wrapped.locator('.line').first()
    const row = (await firstLine.boundingBox())!
    const gutter = (await firstLine.locator('.code-gutter').boundingBox())!
    expect(row.height).toBeGreaterThan(gutter.height * 2)
    expect(gutter.y).toBeCloseTo(row.y, 0)
  })
}
