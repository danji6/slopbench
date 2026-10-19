import { type Page, expect, test } from '@playwright/test'

const approvalSession = '/?fixture=notifications&id=approval-chat'
const otherSession = '/?fixture=notifications&id=other-chat'

async function mockDesktop(page: Page, focused = true, delay = false) {
  await page.addInitScript(
    ({ focused, delay }) => {
      const captures: Array<{
        body: string
        tag: string
        data: { sessionId: string }
        closed?: boolean
      }> = []
      Reflect.set(window, 'desktopNotifications', captures)
      Reflect.set(window, 'notificationTestFocused', focused)
      Reflect.set(window, 'notificationTestVisibility', 'visible')
      Object.defineProperty(document, 'hasFocus', {
        value: () => Reflect.get(window, 'notificationTestFocused'),
      })
      Object.defineProperty(document, 'visibilityState', {
        get: () => Reflect.get(window, 'notificationTestVisibility'),
      })
      Object.defineProperty(window, 'Notification', {
        value: class {
          static permission = 'granted'
          static maxActions = 2
        },
      })
      const registration = {
        showNotification: async (
          _title: string,
          options: (typeof captures)[number],
        ) => captures.push(options),
        getNotifications: async () =>
          captures.map((options) => ({
            ...options,
            close: () => {
              options.closed = true
            },
          })),
      }
      const ready = delay
        ? new Promise<typeof registration>((resolve) =>
            Reflect.set(window, 'finishWorkerRegistration', () =>
              resolve(registration),
            ),
          )
        : Promise.resolve(registration)
      const worker = new EventTarget()
      Object.assign(worker, {
        register: async () => ready,
        getRegistration: async () => registration,
        controller: { postMessage: () => undefined },
      })
      Object.defineProperty(navigator, 'serviceWorker', { value: worker })
    },
    { focused, delay },
  )
}

async function setFocus(page: Page, focused: boolean, visibility = 'visible') {
  await page.evaluate(
    ({ focused, visibility }) => {
      Reflect.set(window, 'notificationTestFocused', focused)
      Reflect.set(window, 'notificationTestVisibility', visibility)
      window.dispatchEvent(new Event(focused ? 'focus' : 'blur'))
      document.dispatchEvent(new Event('visibilitychange'))
    },
    { focused, visibility },
  )
}

const desktopCaptures = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'desktopNotifications'))

test('viewing a session suppresses all popup types but preserves pending inbox requests', async ({
  page,
}) => {
  await mockDesktop(page)
  await page.goto(approvalSession)
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await page.getByRole('button', { name: 'Notify question' }).click()
  await page.getByRole('button', { name: 'Notify activity' }).click()
  await expect(
    page.getByRole('button', { name: 'Notifications, 2 unread', exact: true }),
  ).toBeVisible()
  // Allow the asynchronous cross-tab probe to finish before checking suppression.
  await page.waitForTimeout(300)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  expect(await desktopCaptures(page)).toEqual([])
  await page.getByRole('button', { name: /Notifications/ }).click()
  const inbox = page.getByRole('tabpanel', { name: 'Unread', exact: true })
  await expect(
    inbox.getByText('Approval needed', { exact: true }),
  ).toBeVisible()
  await expect(inbox.getByText('Answer needed', { exact: true })).toBeVisible()
  await expect(
    inbox.getByRole('button', { name: 'Allow', exact: true }),
  ).toBeEnabled()
})

test('viewed requests do not crowd other sessions out of the popup stack', async ({
  page,
}) => {
  await page.goto(approvalSession)
  await page.getByRole('button', { name: 'Notify other session' }).click()
  for (let index = 0; index < 3; index++)
    await page
      .getByRole('button', { name: 'Notify shell', exact: true })
      .click()
  await expect(
    page.getByRole('button', { name: 'Notifications, 4 unread', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
  await expect(page.locator('[data-sonner-toast]')).toContainText(
    'Other session',
  )
})

test('entering a session hides existing popups and leaving restores only pending requests', async ({
  page,
}) => {
  await page.goto(otherSession)
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await page.getByRole('button', { name: 'Notify activity' }).click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(2)
  await page.getByRole('button', { name: 'View approval session' }).click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'View other session' }).click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
  await expect(page.locator('[data-sonner-toast]')).toContainText(
    'Approval needed',
  )
})

for (const state of ['unfocused', 'hidden']) {
  test(`the same session still sends desktop notifications when ${state}`, async ({
    page,
  }) => {
    await mockDesktop(page)
    await page.goto(approvalSession)
    await setFocus(
      page,
      state === 'hidden',
      state === 'hidden' ? 'hidden' : 'visible',
    )
    await page
      .getByRole('button', { name: 'Notify shell', exact: true })
      .click()
    await page.getByRole('button', { name: 'Notify activity' }).click()
    await expect
      .poll(() => desktopCaptures(page))
      .toMatchObject([
        { body: 'Start the local sidecar test server' },
        { body: 'Finished the regression tests' },
      ])
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  })
}

test('returning to the session closes its existing desktop banner and suppresses new arrivals', async ({
  page,
}) => {
  await mockDesktop(page, false)
  await page.goto(approvalSession)
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await expect.poll(() => desktopCaptures(page)).toHaveLength(1)
  await setFocus(page, true)
  await expect
    .poll(() => desktopCaptures(page))
    .toMatchObject([{ closed: true }])
  await page.getByRole('button', { name: 'Notify question' }).click()
  await page.waitForTimeout(300)
  expect(await desktopCaptures(page)).toHaveLength(1)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
})

test('desktop delivery rechecks focus after waiting for worker registration', async ({
  page,
}) => {
  await mockDesktop(page, false, true)
  await page.goto(approvalSession)
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await page.waitForTimeout(150)
  await setFocus(page, true)
  await page.evaluate(() => Reflect.get(window, 'finishWorkerRegistration')())
  await page.waitForTimeout(150)
  expect(await desktopCaptures(page)).toEqual([])
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
})

test('a matching focused session in another tab suppresses alerts without resolving the queue', async ({
  page,
  context,
}) => {
  await page.goto(otherSession)
  const viewing = await context.newPage()
  await viewing.goto(approvalSession)
  await viewing.bringToFront()
  // Simulate arrival in the background tab without giving it focus.
  await page
    .getByRole('button', { name: 'Notify shell', exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click())
  await expect(
    viewing.getByRole('button', {
      name: 'Notifications, 1 unread',
      exact: true,
    }),
  ).toBeVisible()
  await page.waitForTimeout(300)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await expect(viewing.locator('[data-sonner-toast]')).toHaveCount(0)
  await viewing.getByRole('button', { name: 'View other session' }).click()
  await expect(viewing.locator('[data-sonner-toast]')).toHaveCount(1)
})

test('focus changes still hide and restore the stack without BroadcastChannel support', async ({
  page,
}) => {
  await mockDesktop(page)
  await page.addInitScript(() =>
    Reflect.deleteProperty(window, 'BroadcastChannel'),
  )
  await page.goto(otherSession)
  await page.getByRole('button', { name: 'Notify shell', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
  await setFocus(page, false)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await setFocus(page, true)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
})
