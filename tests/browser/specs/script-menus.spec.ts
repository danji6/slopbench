import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=script-menus')
  await expect(page.getByTestId('message')).toBeVisible()
})

for (const readOnly of [false, true]) {
  test(`Scripts opens the manager without editing or running scripts (read only: ${readOnly})`, async ({
    page,
  }) => {
    if (readOnly) await page.getByLabel('Read only').check()
    await page.getByTestId('message').click({ button: 'right' })
    const items = page.getByRole('menuitem')
    const names = await items.allTextContents()
    expect(names.indexOf('Scripts')).toBe(names.indexOf('Copy Message') + 1)
    await page.getByRole('menuitem', { name: 'Scripts', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Manage your scripts.')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(
      page.getByLabel('Editing message', { exact: true }),
    ).toHaveText('none')
    await expect(page.getByLabel('Script actions', { exact: true })).toHaveText(
      '0',
    )
    expect(new URL(page.url()).searchParams.get('view')).toBe('scripts')
  })
}

test('the built-in bubble toolbar has formatting actions and no Delete action', async ({
  page,
}) => {
  await expect(
    page.getByRole('button', { name: 'Clear formatting', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Bold', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Delete', exact: true }),
  ).toHaveCount(0)
})

test('the context menu remains disabled for a message being edited', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Start editing', exact: true }).click()
  await expect(page.getByLabel('Editing message', { exact: true })).toHaveText(
    'fixture',
  )
  await page.getByTestId('message').click({ button: 'right' })
  await expect(page.getByRole('menu')).toHaveCount(0)
})
