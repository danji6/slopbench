import { type Locator, type Page, expect, test } from '@playwright/test'

async function openThinking(page: Page) {
  await page.goto('/?fixture=notes&id=notes&tailWork')
  const work = page.locator('[data-slot="work-block"]')
  await work.click()
  const blocks = page.locator('[data-slot="reasoning-block"]')
  await expect(blocks).toHaveCount(8)
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

async function expectNoRetainedSpace(block: Locator) {
  await expect(block.locator('[style*="grid-template-rows"]')).toHaveCount(0)
  await expect
    .poll(() =>
      block.evaluate((element) => {
        const wrapper = element.closest(
          '[data-slot="message-row"]',
        )!.firstElementChild!
        return (
          wrapper.getBoundingClientRect().height -
          element.getBoundingClientRect().height
        )
      }),
    )
    .toBeLessThanOrEqual(1)
}

test('delayed thinking collapse releases its retained height', async ({
  page,
}) => {
  const block = (await openThinking(page)).first()
  await block.getByRole('button').click()
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
