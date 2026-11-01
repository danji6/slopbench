import { expect, test } from '@playwright/test'

test('shows five files, previews on hover and keeps only one accordion expanded', async ({
  page,
}) => {
  await page.goto('/?fixture=changes')
  await expect(page.getByText('Changes made')).toBeVisible()
  await expect(page.getByText('8 files', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /src\/file-/ })).toHaveCount(5)
  const first = page.getByRole('button', { name: /src\/file-1.ts/ })
  await first.hover()
  const preview = page.getByRole('dialog')
  await expect(preview).toBeVisible()
  await expect(
    preview.getByText('before file-1', { exact: true }),
  ).toBeVisible()
  await preview.hover()
  await expect(preview).toBeVisible()
  await first.click()
  await expect(preview).not.toBeVisible()
  await expect(first).toHaveAttribute('aria-expanded', 'true')
  const second = page.getByRole('button', { name: /src\/file-2.ts/ })
  await second.click()
  await expect(first).toHaveAttribute('aria-expanded', 'false')
  await expect(second).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Show 3 more files' }).click()
  await expect(page.getByRole('button', { name: /src\/file-/ })).toHaveCount(8)
  const expandedHeight = await page
    .getByTestId('summary-row')
    .evaluate((element) => element.getBoundingClientRect().height)
  await page.getByRole('button', { name: 'Show fewer files' }).click()
  await expect(page.getByRole('button', { name: /src\/file-/ })).toHaveCount(5)
  await expect
    .poll(() =>
      page
        .getByTestId('summary-row')
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeLessThan(expandedHeight)
})

test('updates revert/reapply reactively and reports conflicting files', async ({
  page,
}) => {
  await page.goto('/?fixture=changes')
  await page.getByRole('button', { name: 'Revert changes' }).click()
  await expect(page.getByRole('button', { name: 'Applying…' })).toBeDisabled()
  await page.getByRole('button', { name: 'Complete operation' }).click()
  await expect(
    page.getByRole('button', { name: 'Reapply changes' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Reapply changes' }).click()
  await page.getByRole('button', { name: 'Complete operation' }).click()
  await expect(
    page.getByRole('button', { name: 'Revert changes' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Revert changes' }).click()
  await page.getByRole('button', { name: 'Report conflict' }).click()
  await expect(page.getByRole('alert')).toContainText('No files were changed')
  await expect(page.getByRole('alert')).toContainText('src/file-2.ts')
})

test('retains the hover diff until the popover finishes its exit transition', async ({
  page,
}) => {
  await page.goto('/?fixture=changes')
  // Slow the transition so the closing state can be inspected reliably.
  await page.addStyleTag({
    content:
      '[data-slot="popover-content"] { transition-duration: 800ms !important; }',
  })
  await page.getByRole('button', { name: /src\/file-1.ts/ }).hover()
  const preview = page.getByRole('dialog')
  await expect(
    preview.getByText('before file-1', { exact: true }),
  ).toBeVisible()
  await preview.hover()
  await preview.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  )
  await page.mouse.move(0, 0)
  const closing = page.locator(
    '[data-slot="popover-content"][data-ending-style]',
  )
  await expect(closing).toHaveCount(1)
  await expect(
    closing.getByText('before file-1', { exact: true }),
  ).toBeAttached()
  await expect(preview).toHaveCount(0)
})

test('keeps long diagnostics to one collapsed line and exposes the full error on demand', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 })
  await page.goto('/?fixture=changes')
  await page.getByRole('button', { name: 'Report capture issue' }).click()
  const notice = page.getByRole('status')
  const trigger = notice.getByRole('button')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  const label = trigger.locator('span').first()
  expect(
    await label.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true)
  await expect(
    page.getByRole('button', { name: 'Revert changes' }),
  ).toBeEnabled()
  const collapsedHeight = await notice.evaluate(
    (element) => element.getBoundingClientRect().height,
  )
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(
    notice.getByText(/fatal: directory entry/, { exact: false }).last(),
  ).toBeVisible()
  await expect
    .poll(() =>
      notice.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(collapsedHeight)
  const expandedHeight = await page
    .getByTestId('summary-row')
    .evaluate((element) => element.getBoundingClientRect().height)
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect
    .poll(() =>
      page
        .getByTestId('summary-row')
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeLessThan(expandedHeight)
  await page.getByRole('button', { name: 'Report restore error' }).click()
  const error = page.getByRole('alert')
  await expect(error.getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await error.getByRole('button').click()
  await expect(
    error
      .getByText(
        'Could not restore changes.\nThe local server is unavailable.',
        {
          exact: true,
        },
      )
      .last(),
  ).toBeVisible()
})

test('hides completed summaries with no file changes even when capture has warnings', async ({
  page,
}) => {
  await page.goto('/?fixture=changes')
  await expect(
    page.getByRole('region', { name: 'Agent changes' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Report no changes' }).click()
  await expect(page.getByRole('region', { name: 'Agent changes' })).toHaveCount(
    0,
  )
})
