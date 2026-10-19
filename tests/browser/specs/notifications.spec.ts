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
      tag: string
      closed?: boolean
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
      getNotifications: async () =>
        captures.map((options) => ({
          ...options,
          close: () => {
            options.closed = true
          },
        })),
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
        requireInteraction: true,
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
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(window, 'desktopNotifications')[0]?.closed,
      ),
    )
    .toBe(true)
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

test('persistent stack preserves all approvals in the inbox after minimizing', async ({
  page,
}) => {
  const notify = page.getByRole('button', {
    name: 'Notify shell',
    exact: true,
  })
  for (let index = 0; index < 4; index++) {
    await notify.click()
  }
  await expect(
    page.getByRole('button', { name: 'Notifications, 4 unread' }),
  ).toBeVisible()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(3)
  await page.clock.install()
  await page.clock.fastForward(30_000)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(3)
  await page
    .locator('[data-sonner-toast][data-front=true]')
    .getByRole('button', { name: 'Minimize', exact: true })
    .click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)

  for (let remaining = 4; remaining > 0; remaining--) {
    await page.getByRole('button', { name: /Notifications/ }).click()
    const inbox = page.getByRole('tabpanel', { name: 'Unread', exact: true })
    const allow = inbox.getByRole('button', { name: 'Allow', exact: true })
    await expect(allow).toHaveCount(remaining)
    await allow.first().click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Complete response' }).click()
  }

  const log = page.getByRole('status', { name: 'Approval mutations' })
  const responses: { notificationId: string }[] = JSON.parse(
    (await log.textContent())!,
  )
  expect(responses.map((response) => response.notificationId)).toEqual([
    'notification_0',
    'notification_1',
    'notification_2',
    'notification_3',
  ])
  await expect(
    page.getByRole('button', { name: 'Notifications', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/id=other-chat/)
})

test('minimization survives reload and new requests restore the native newest-first stack', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await page
    .locator('[data-sonner-toast][data-front=true]')
    .getByRole('button', { name: 'Minimize', exact: true })
    .click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Notify file', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(2)
  await expect(
    page.locator('[data-sonner-toast][data-front=true]'),
  ).toContainText('write_file: src/server.ts')
  await page
    .getByRole('button', { name: 'Notify question', exact: true })
    .click()
  await expect(
    page.locator('[data-sonner-toast][data-front=true]'),
  ).toContainText('Which deployment target?')
  await page
    .getByRole('button', { name: 'Notifications, 3 unread', exact: true })
    .click()
  const entries = page
    .getByRole('tabpanel', { name: 'Unread', exact: true })
    .locator('[data-notification-id]')
  await expect(entries).toHaveCount(3)
  await expect(entries.nth(0)).toContainText(
    'Start the local sidecar test server',
  )
  await expect(entries.nth(1)).toContainText('write_file: src/server.ts')
  await expect(entries.nth(2)).toContainText('Which deployment target?')
})

test('opening a question keeps it pending and expiry needs explicit acknowledgement', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Notify question', exact: true })
    .click()
  const card = page.locator('[data-sonner-toast][data-front=true]')
  await card.getByRole('button', { name: 'Open chat', exact: true }).click()
  await expect(page).toHaveURL(/id=approval-chat/)
  await expect(card).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Expire requests', exact: true })
    .click()
  await expect(card).not.toBeVisible()
  await page
    .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
    .click()
  const inbox = page.getByRole('tabpanel', { name: 'Unread', exact: true })
  await expect(inbox.getByText('Expired', { exact: true })).toBeVisible()
  await expect(
    inbox.getByRole('button', { name: 'Mark all as read', exact: true }),
  ).toBeDisabled()
  await inbox
    .getByRole('button', { name: 'Acknowledge expired request', exact: true })
    .click()
  await expect(
    inbox.getByText('No unread notifications', { exact: true }),
  ).toBeVisible()
})

test('pending requests remain available beyond the first inbox page', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Notify thirty', exact: true }).click()
  await page
    .getByRole('button', { name: 'Notifications, 30 unread', exact: true })
    .click()
  const inbox = page.getByRole('tabpanel', { name: 'Unread', exact: true })
  await expect(inbox.locator('[data-notification-id]')).toHaveCount(25)
  await inbox.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(inbox.locator('[data-notification-id]')).toHaveCount(30)
})

test('the queue transfers between tabs and survives the presenting tab closing', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
  const other = await context.newPage()
  await other.goto('/?fixture=notifications&id=other-chat')
  await other.bringToFront()
  await expect(other.locator('[data-sonner-toast]')).toHaveCount(1)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await other.close()
  await page.bringToFront()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
})

test('notification settings disable all desktop delivery and persist across reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const captures: unknown[] = []
    Reflect.set(window, 'desktopNotifications', captures)
    Object.defineProperty(window, 'Notification', {
      value: class {
        static permission = 'granted'
        static requestPermission = async () => 'granted'
        static maxActions = 2
      },
    })
    const worker = new EventTarget()
    const registration = {
      showNotification: async (_title: string, options: unknown) =>
        captures.push(options),
      getNotifications: async () => [],
    }
    Object.assign(worker, {
      register: async () => registration,
      getRegistration: async () => registration,
      controller: { postMessage: () => undefined },
    })
    Object.defineProperty(navigator, 'serviceWorker', { value: worker })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page
    .getByRole('button', { name: 'Notification settings', exact: true })
    .click()
  const toggle = page.getByRole('switch', {
    name: 'Enable desktop notifications',
    exact: true,
  })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page
    .getByRole('button', { name: 'Notification settings', exact: true })
    .click()
  await expect(toggle).not.toBeChecked()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(() =>
    Object.defineProperty(document, 'hasFocus', {
      value: () => false,
      configurable: true,
    }),
  )
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await page.getByRole('button', { name: 'Notify file', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Notifications, 2 unread', exact: true }),
  ).toBeVisible()
  await page.waitForTimeout(500)
  expect(
    await page.evaluate(() => Reflect.get(window, 'desktopNotifications')),
  ).toEqual([])
  await page.evaluate(() =>
    Object.defineProperty(document, 'hasFocus', {
      value: () => true,
      configurable: true,
    }),
  )
  await page
    .getByRole('button', { name: 'Notifications, 2 unread', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Notification settings', exact: true })
    .click()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(() =>
    Object.defineProperty(document, 'hasFocus', {
      value: () => false,
      configurable: true,
    }),
  )
  await page
    .getByRole('button', { name: 'Notify question', exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, 'desktopNotifications')),
    )
    .toMatchObject([
      { body: 'Which deployment target?', requireInteraction: true },
    ])
})

test('resolving requests keeps a large minimized queue minimized while older candidates replenish', async ({
  page,
}) => {
  for (let index = 0; index < 4; index++)
    await page
      .getByRole('button', { name: 'Notify thirty', exact: true })
      .click()
  await expect(
    page.getByRole('button', {
      name: 'Notifications, 120 unread',
      exact: true,
    }),
  ).toBeVisible()
  await page
    .locator('[data-sonner-toast][data-front=true]')
    .getByRole('button', { name: 'Minimize', exact: true })
    .click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Resolve newest', exact: true })
    .click()
  await expect(
    page.getByRole('button', {
      name: 'Notifications, 119 unread',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
})
