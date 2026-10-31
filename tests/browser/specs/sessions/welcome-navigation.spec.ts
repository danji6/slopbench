import { expect, test } from '@playwright/test'

test('welcome views clear the mobile navigation at narrow and tablet widths', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 568 })
    for (const state of ['noAgent', 'noProviders', '', 'prompts']) {
      await page.goto(`/?fixture=empty-chat&withNavigation&${state}`)
      const navigation = page.locator('[data-slot="mobile-nav-toggle"]')
      await expect(navigation).toHaveCount(2)
      const content = page.locator('[data-slot="chat-layout"]')
      const welcome =
        state === 'prompts'
          ? content.getByText('I am your configured welcome prompt.')
          : content.getByRole('heading').first()
      await expect(welcome).toBeVisible()
      const navBottom = await navigation.evaluateAll((elements) =>
        Math.max(
          ...elements.map((element) => element.getBoundingClientRect().bottom),
        ),
      )
      expect((await welcome.boundingBox())!.y).toBeGreaterThan(navBottom)
      const switchAgent = content.getByRole('button', {
        name: 'Choose another agent',
      })
      if (await switchAgent.count()) {
        expect((await switchAgent.boundingBox())!.y).toBeGreaterThan(navBottom)
      }
    }
  }
})
