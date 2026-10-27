import { type Page, expect, test } from '@playwright/test'

async function expandPasswordSection(page: Page) {
  const trigger = page.locator('[data-slot="collapsible-trigger"]')
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click()
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin':
          route.request().headers().origin ?? 'http://127.0.0.1:4178',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      },
      body: JSON.stringify({ success: true }),
    })
  })
  await page.goto('/?fixture=account-security')
  await expect(
    page.getByRole('heading', { name: 'Account', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Old password', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Logout', exact: true }),
  ).toBeVisible()
  await expandPasswordSection(page)
})

test('Enter changes the password without saving settings or storing passwords', async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = []
  page.on('request', (request) => {
    if (
      request.url().endsWith('/change-password') &&
      request.method() === 'POST'
    ) {
      requests.push(request.postDataJSON())
    }
  })
  await page.getByLabel('Name', { exact: true }).fill('Edited name')
  await page.getByLabel('Old password', { exact: true }).fill('old-password')
  await page.getByLabel('New password', { exact: true }).fill('new-password')
  await page
    .getByLabel('Repeat new password', { exact: true })
    .fill('new-password')
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(localStorage)))
    .toContain('Edited name')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'password',
  )

  await page.getByLabel('Repeat new password', { exact: true }).press('Enter')
  await expect(page.getByLabel('Old password', { exact: true })).toHaveValue('')
  expect(requests).toEqual([
    {
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    },
  ])
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Edited name',
  )
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByLabel('Settings saves')).toHaveText('1')
})

test('logout confirmation preserves edits on cancel and clears the draft on success', async ({
  page,
}) => {
  await page.getByLabel('Name', { exact: true }).fill('Edited name')
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Edited name',
  )
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await page.getByRole('button', { name: 'Discard and log out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'Edited name',
  )
})

test('clears password entries on tab changes and dialog closure', async ({
  page,
}) => {
  await page.getByLabel('Old password', { exact: true }).fill('old-password')
  await page.getByRole('tab', { name: 'Tools' }).click()
  await page.getByRole('tab', { name: 'Account' }).click()
  await expandPasswordSection(page)
  await expect(page.getByLabel('Old password', { exact: true })).toHaveValue('')
  await page.getByLabel('Old password', { exact: true }).fill('old-password')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expandPasswordSection(page)
  await expect(page.getByLabel('Old password', { exact: true })).toHaveValue('')
})

test('Account fits desktop and mobile with logout after the password section', async ({
  page,
}, info) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(
      page.getByLabel('Repeat new password', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Logout', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('tab', { selected: true })).toHaveText(
      viewport.width < 768 ? '' : 'Account',
    )
    const positions = await page.getByRole('tabpanel').evaluate((panel) => {
      const name = panel.querySelector('input')!
      const section = panel.querySelector('h3')!
      const logout = [...panel.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Logout',
      )!
      return [name, section, logout].map(
        (element) => element.getBoundingClientRect().y,
      )
    })
    expect(positions[0]).toBeLessThan(positions[1])
    expect(positions[1]).toBeLessThan(positions[2])
    await page.screenshot({
      path: info.outputPath(`account-${viewport.width}.png`),
      animations: 'disabled',
    })
  }
})
