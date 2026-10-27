import { expect, test } from '@playwright/test'

for (const scenario of ['normal', 'serialized']) {
  test(`skill listings are collapsed, named, and bounded (${scenario})`, async ({
    page,
  }) => {
    await page.goto(`/?fixture=skill-tools&scenario=${scenario}`)
    const block = page.locator('[data-tool-call-id="skills"]')
    await expect(block).toHaveAttribute('data-open', 'false')
    await expect(page.getByRole('list')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Listed skills containing "game"' }),
    ).toBeVisible()
    await block.getByRole('button', { name: /^Listed skills/ }).click()
    const list = block.getByRole('list', { name: 'Skills' })
    await expect(list).toBeVisible()
    await expect(list.getByRole('listitem')).toHaveCount(20)
    await expect(block).not.toContainText('Private skill description')
    await expect(block).not.toContainText('/private/agent-home')
    await expect(block).not.toContainText('Input')
    await expect(block).not.toContainText('Output')

    for (const width of [800, 320]) {
      await page.setViewportSize({ width, height: 600 })
      await expect
        .poll(() =>
          list.evaluate((element) => ({
            bounded: element.clientHeight <= 192,
            scrollable: element.scrollHeight > element.clientHeight,
            fits: element.scrollWidth <= element.clientWidth,
            pageFits: document.documentElement.scrollWidth <= window.innerWidth,
          })),
        )
        .toEqual({
          bounded: true,
          scrollable: true,
          fits: true,
          pageFits: true,
        })
      if (scenario === 'normal' && width === 800) {
        await page.getByRole('main').screenshot({
          path: '/tmp/slopbench-listed-skills.png',
          animations: 'disabled',
        })
      }
      await list.focus()
      await page.keyboard.press('End')
      await expect
        .poll(() => list.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0)
    }
    await block.getByRole('button', { name: /^Listed skills/ }).click()
    await expect(block).toHaveAttribute('data-open', 'false')
    await expect(list).not.toBeVisible()
  })
}

test('empty results and tool errors keep useful feedback', async ({ page }) => {
  await page.goto('/?fixture=skill-tools&scenario=empty')
  const block = page.locator('[data-tool-call-id="skills"]')
  await block.getByRole('button', { name: /^Listed skills/ }).click()
  await expect(block.getByText('No skills found.')).toBeVisible()

  await page.goto('/?fixture=skill-tools&scenario=error')
  await expect(block.getByText('Could not list skills.')).toBeVisible()
  await expect(block).not.toContainText('No skills found.')
})

test('results stay collapsed when a pending listing finishes', async ({
  page,
}) => {
  await page.goto('/?fixture=skill-tools&scenario=pending')
  const block = page.locator('[data-tool-call-id="skills"]')
  await expect(block).toHaveAttribute('data-open', 'false')
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await expect(block).toHaveAttribute('data-open', 'false')
  await expect(block.getByRole('list')).toHaveCount(0)
  await block.getByRole('button', { name: /^Listed skills/ }).click()
  await expect(block.getByRole('listitem')).toHaveCount(20)
})
