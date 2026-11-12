import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=script-menus')
  await expect(page.getByTestId('message')).toBeVisible()
})

for (const readOnly of [false, true]) {
  test(`the message context menu omits Scripts (read only: ${readOnly})`, async ({
    page,
  }) => {
    if (readOnly) await page.getByLabel('Read only').check()
    await page.getByTestId('message').click({ button: 'right' })
    await expect(
      page.getByRole('menuitem', { name: 'Copy Message', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('menu').getByRole('separator')).toHaveCount(
      readOnly ? 0 : 1,
    )
    await expect(
      page.getByRole('menuitem', { name: 'Scripts', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByLabel('Editing message', { exact: true }),
    ).toHaveText('none')
    await expect(page.getByLabel('Script actions', { exact: true })).toHaveText(
      '0',
    )
    expect(new URL(page.url()).searchParams.has('view')).toBe(false)
  })
}

for (const role of ['user', 'assistant'] as const) {
  test(`separates the visible action groups for an attachment-only ${role} message`, async ({
    page,
  }) => {
    await page.goto(`/?fixture=script-menus&attachmentOnly=${role}`)
    await page.getByTestId('message').click({ button: 'right' })

    const menu = page.getByRole('menu')
    const hasRetry = role === 'assistant'
    await expect(menu.getByRole('menuitem')).toHaveText(
      hasRetry ? ['Retry', 'Delete Message'] : ['Delete Message'],
    )
    await expect(menu.getByRole('separator')).toHaveCount(hasRetry ? 1 : 0)
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
