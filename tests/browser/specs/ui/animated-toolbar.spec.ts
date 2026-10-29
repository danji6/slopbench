import { type Locator, expect, test } from '@playwright/test'

async function sampleToggle(toolbar: Locator, visible: boolean) {
  return toolbar.evaluate(async (element, showing) => {
    const width = () =>
      element
        .querySelector('[data-slot="animated-toolbar-item"]')
        ?.getBoundingClientRect().width ?? 0
    const widths = [width()]
    element.querySelector<HTMLButtonElement>('button')!.click()
    await new Promise(requestAnimationFrame)
    const exiting = element.querySelector<HTMLElement>(
      '[data-slot="animated-toolbar-item"]',
    )
    const inert = exiting?.inert ?? true
    const start = performance.now()
    const target = showing ? 96 : 0
    do {
      await new Promise(requestAnimationFrame)
      widths.push(width())
    } while (
      Math.abs(width() - target) > 0.1 &&
      performance.now() - start < 1000
    )
    return { widths, inert }
  }, visible)
}

test('toolbar actions animate their space, leave the tab order on exit, and can reverse', async ({
  page,
}) => {
  await page.goto('/?fixture=ui-layout')
  const toolbar = page.getByTestId('example-toolbar')
  const extra = toolbar.getByRole('button', {
    name: 'Extra action',
    exact: true,
  })
  const entering = await sampleToggle(toolbar, true)
  expect(entering.widths.at(-1)).toBeCloseTo(96, 0)
  expect(entering.widths.some((width) => width > 1 && width < 95)).toBe(true)
  await expect(extra).toBeVisible()

  const exiting = await sampleToggle(toolbar, false)
  expect(exiting.inert).toBe(true)
  expect(exiting.widths.at(-1)).toBeCloseTo(0, 0)
  expect(exiting.widths.some((width) => width > 1 && width < 95)).toBe(true)
  await expect(extra).toHaveCount(0)
  await expect(
    toolbar.locator('[data-slot="animated-toolbar-item"]'),
  ).toHaveCount(0)

  await toolbar.evaluate(async (element) => {
    const toggle = element.querySelector<HTMLButtonElement>('button')!
    for (let count = 0; count < 3; count++) {
      toggle.click()
      await new Promise(requestAnimationFrame)
    }
  })
  await expect(extra).toBeVisible()
  await expect(toolbar.locator('[inert]')).toHaveCount(0)
})

test('toolbar actions show and hide immediately with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?fixture=ui-layout')
  const toolbar = page.getByTestId('example-toolbar')
  for (const visible of [true, false]) {
    const { widths } = await sampleToggle(toolbar, visible)
    expect(widths.every((width) => width === 0 || width === 96)).toBe(true)
    expect(widths.at(-1)).toBe(visible ? 96 : 0)
  }
})
