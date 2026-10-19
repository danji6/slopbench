import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=notifications&id=other-chat')
})

test('toast shows the agent description and applies a session approval without navigation', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Start the local sidecar test server' })
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await page.screenshot({ path: testInfo.outputPath('notification-toast.png') })
  await expect(
    toast.getByRole('button', { name: 'Deny', exact: true }),
  ).toBeVisible()
  await toast
    .getByRole('button', { name: 'Allow for this session', exact: true })
    .click()
  await expect(
    toast.getByRole('button', { name: 'Allow', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole('status', { name: 'Approval mutations' }),
  ).toContainText('allow-session')
  await page.getByRole('button', { name: 'Complete response' }).click()
  await expect(toast).not.toBeVisible()
  await expect(page).toHaveURL(/id=other-chat/)
})

test('desktop options contain the description and a session click responds in the background', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const captures: Array<{
      data: { notificationId: string; sessionId: string }
      body: string
      actions: unknown[]
    }> = []
    Object.defineProperty(window, 'desktopNotifications', { value: captures })
    Object.defineProperty(document, 'hasFocus', { value: () => false })
    Object.defineProperty(window, 'Notification', {
      value: class {
        static permission = 'granted'
        static maxActions = 2
      },
    })
    const worker = new EventTarget()
    const registration = {
      showNotification: async (
        _title: string,
        options: (typeof captures)[number],
      ) => {
        captures.push(options)
      },
      getNotifications: async () => [],
    }
    Object.assign(worker, {
      register: async () => registration,
      getRegistration: async () => registration,
      controller: { postMessage: () => undefined },
    })
    Object.defineProperty(navigator, 'serviceWorker', { value: worker })
  })
  await page.goto('/?fixture=notifications&id=other-chat')
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, 'desktopNotifications')),
    )
    .toMatchObject([
      {
        body: 'Start the local sidecar test server',
        actions: [
          { action: 'allow', title: 'Allow' },
          { action: 'allow-session', title: 'Allow for this session' },
        ],
      },
    ])
  await page.evaluate(() => {
    const captures = Reflect.get(window, 'desktopNotifications')
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'slopbench:notification-action',
          action: 'allow-session',
          ...captures[0].data,
          requestId: 'desktop-click',
        },
      }),
    )
  })
  await expect(
    page.getByRole('status', { name: 'Approval mutations' }),
  ).toContainText('allow-session')
  await page.getByRole('button', { name: 'Complete response' }).click()
  await expect(page).toHaveURL(/id=other-chat/)
})

test('inbox file requests use the existing path summary and support Deny', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Notify file', exact: true }).click()
  await page.getByRole('button', { name: /Notifications/ }).click()
  const inbox = page.getByRole('tabpanel', { name: 'Unread', exact: true })
  await expect(
    inbox.getByText('write_file: src/server.ts', { exact: true }),
  ).toBeVisible()
  await inbox.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(
    page.getByRole('status', { name: 'Approval mutations' }),
  ).toContainText('deny')
  // Complete the mocked mutation through the fixture while the popover stays open.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Complete response' }).click()
  await page.getByRole('button', { name: /Notifications/ }).click()
  await page.getByRole('tab', { name: 'Read', exact: true }).click()
  const read = page.getByRole('tabpanel', { name: 'Read', exact: true })
  await expect(
    read.getByText('write_file: src/server.ts', { exact: true }),
  ).toBeVisible()
  await expect(
    read.getByRole('button', { name: 'Allow', exact: true }),
  ).toHaveCount(0)
})

test('failed approval stays actionable and can be retried', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Fail next approval' }).click()
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Start the local sidecar test server' })
  await toast.getByRole('button', { name: 'Allow', exact: true }).click()
  await page.getByRole('button', { name: 'Complete response' }).click()
  await expect(
    toast.getByRole('button', { name: 'Allow', exact: true }),
  ).toBeEnabled()
  await toast.getByRole('button', { name: 'Allow', exact: true }).click()
  await page.getByRole('button', { name: 'Complete response' }).click()
  await expect(toast).not.toBeVisible()
})

test('an approval resolved elsewhere closes its toast', async ({ page }) => {
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Start the local sidecar test server' })
  await expect(toast).toBeVisible()
  await page.getByRole('button', { name: 'Resolve elsewhere' }).click()
  await expect(toast).not.toBeVisible()
})
