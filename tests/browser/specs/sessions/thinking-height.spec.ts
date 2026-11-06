import { type Locator, type Page, expect, test } from '@playwright/test'

async function openThinking(page: Page) {
  await page.goto('/?fixture=notes&id=notes&tailWork')
  const work = page.locator('[data-slot="work-block"]')
  await work.click()
  const blocks = page.locator('[data-slot="reasoning-block"]')
  await expect(blocks.first()).toBeVisible()
  await expect
    .poll(async () => {
      const thinkingIcon = await blocks
        .first()
        .locator('svg')
        .first()
        .boundingBox()
      const readIcon = await page
        .locator('[data-slot="read-file-block"] svg')
        .first()
        .boundingBox()
      return thinkingIcon && readIcon
        ? Math.abs(thinkingIcon.x - readIcon.x)
        : Infinity
    })
    .toBeLessThanOrEqual(1)
  return blocks
}

async function waitForAnimations(block: Locator) {
  await block.evaluate(async (element) => {
    await Promise.allSettled(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    )
  })
}

async function expectAnimatedExpansion(block: Locator) {
  const insets = await block.evaluate(async (element) => {
    const button = element.querySelector<HTMLButtonElement>('button')!
    const inset = () =>
      button.getBoundingClientRect().top - element.getBoundingClientRect().top
    const closed = inset()
    button.click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const animations = element.getAnimations({ subtree: true })
    const sample = (time: number) => {
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = time
      }
      return inset()
    }
    const start = sample(0)
    const middle = sample(100)
    for (const animation of animations) animation.finish()
    return { closed, start, middle, end: inset() }
  })
  expect(Math.abs(insets.start - insets.closed)).toBeLessThanOrEqual(1)
  expect(insets.middle).toBeGreaterThan(insets.start + 1)
  expect(insets.middle).toBeLessThan(insets.end - 1)
}

async function expectNoRetainedSpace(block: Locator) {
  await expect(block.locator('[style*="grid-template-rows"]')).toHaveCount(0)
  await expect
    .poll(() =>
      block.evaluate((element) => {
        const wrapper = element.closest(
          '[data-slot="message-row"]',
        )!.firstElementChild!
        const group = element.closest('[data-slot="message-group"]')!
        return (
          wrapper.getBoundingClientRect().height -
          group.getBoundingClientRect().height
        )
      }),
    )
    .toBeLessThanOrEqual(1)
}

test('delayed thinking collapse releases its retained height', async ({
  page,
}) => {
  const block = (await openThinking(page)).first()
  await expectAnimatedExpansion(block)
  await waitForAnimations(block)
  await block.evaluate((element) => {
    const content = element.querySelector<HTMLElement>(
      '[style*="grid-template-rows"]',
    )!
    ;(element as HTMLElement).style.transitionDelay = '80ms'
    content.style.transitionDelay = '80ms'
  })
  await block.getByRole('button').click()
  await expectNoRetainedSpace(block)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`interrupted thinking collapse releases its height (reducedMotion=${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion })
    const block = (await openThinking(page)).first()
    await block.getByRole('button').click()
    await waitForAnimations(block)
    await block.getByRole('button').evaluate((button: HTMLButtonElement) => {
      button.click()
      requestAnimationFrame(() => button.click())
    })
    await expect(block).toHaveAttribute('data-open', 'true')
    await waitForAnimations(block)
    await block.getByRole('button').click()
    await expectNoRetainedSpace(block)
  })
}
