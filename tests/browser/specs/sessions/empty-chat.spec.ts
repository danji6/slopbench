import { expect, test } from '@playwright/test'
import { APP_ID } from '@sb/core/const'

test('provider setup overrides prompts and selection, and updates after setup', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat&noProviders&prompts')
  await expect(
    page.getByRole('heading', { name: 'Connect a model provider' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Choose another agent' }),
  ).toHaveCount(0)
  await expect(
    page.getByText('I am your configured welcome prompt.'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Open models settings' }).click()
  expect(new URL(page.url()).searchParams.get('view')).toBe('settings:models')
  await page.evaluate(() => window.dispatchEvent(new Event('add-provider')))
  await expect(
    page.getByText('I am your configured welcome prompt.'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Choose another agent' }),
  ).toBeVisible()
})

test('agent grid loads four, expands, and searches beyond loaded names and descriptions', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat&noAgent')
  const grid = page.getByRole('region', { name: 'Choose an agent' })
  await expect(grid.getByRole('button', { name: /^Agent \d/ })).toHaveCount(4)
  await expect(grid.getByRole('button', { name: /^Agent 0 / })).toContainText(
    'No description provided',
  )
  await grid.getByRole('button', { name: 'View all agents' }).click()
  await expect(grid.getByRole('button', { name: /^Agent \d/ })).toHaveCount(16)
  await grid.getByRole('button', { name: 'Load more agents' }).click()
  await expect(grid.getByRole('button', { name: /^Agent \d/ })).toHaveCount(28)
  await page
    .getByRole('textbox', { name: 'Search agents' })
    .fill('DOCUMENTATION')
  await expect(grid.getByRole('button', { name: /^Agent 29/ })).toBeVisible()
  await expect(grid.getByRole('button', { name: /^Agent \d/ })).toHaveCount(1)
  await grid.getByRole('button', { name: /^Agent 29/ }).click()
  await expect(
    page.getByText('A few ways to get going with Agent 29.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Choose another agent' }).click()
  await expect(grid.getByRole('button', { name: /^Agent \d/ })).toHaveCount(4)
  await expect(
    grid.getByRole('button', { name: /^Agent \d/ }).first(),
  ).toContainText('Agent 29')
})

test('agent pagination keeps cards unclipped and the list still while loading', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 2400 })
  await page.goto('/?fixture=empty-chat&noAgent&deferAgentPages')
  const grid = page.getByRole('region', { name: 'Choose an agent' })
  const cards = grid.getByRole('button', { name: /^Agent \d/ })
  const firstCard = cards.first()
  await expect(cards).toHaveCount(4)
  const chromeHeight = () =>
    firstCard.evaluate((button) => {
      const section = button.closest('section')!
      const cardGrid = button.closest('.grid')!
      return (
        section.getBoundingClientRect().height -
        cardGrid.getBoundingClientRect().height
      )
    })
  const fixedHeight = await chromeHeight()

  for (const count of [16, 28, 30]) {
    const action = grid.getByRole('button', {
      name: count === 16 ? 'View all agents' : 'Load more agents',
    })
    await action.click({ trial: true })
    const heading = grid.getByRole('heading')
    const headingBefore = (await heading.boundingBox())!
    const before = (await firstCard.boundingBox())!
    await action.click()
    await expect(
      grid.getByRole('button', { name: 'Loading agents…' }),
    ).toBeDisabled()
    const during = (await firstCard.boundingBox())!
    expect(Math.abs(during.y - before.y)).toBeLessThan(1)
    const unclipped = await page.evaluate(
      (count) =>
        new Promise<boolean>((resolve) => {
          function sample() {
            const buttons = document.querySelectorAll<HTMLButtonElement>(
              'section[aria-label="Choose an agent"] .grid button',
            )
            const card = buttons[count - 1]
            if (card) {
              const bounds = card.getBoundingClientRect()
              if (Math.abs(bounds.height - card.offsetHeight) > 1) {
                resolve(false)
                return
              }
              for (
                let parent = card.parentElement;
                parent;
                parent = parent.parentElement
              ) {
                if (getComputedStyle(parent).overflowY === 'visible') continue
                const clip = parent.getBoundingClientRect()
                if (
                  bounds.top < clip.top - 1 ||
                  bounds.bottom > clip.bottom + 1
                ) {
                  resolve(false)
                  return
                }
              }
              const style = getComputedStyle(card.parentElement!)
              const offset = new DOMMatrixReadOnly(style.transform).m42
              if (style.opacity === '1' && offset === 0) {
                resolve(true)
                return
              }
            }
            requestAnimationFrame(sample)
          }
          window.dispatchEvent(new Event('load-agent-page'))
          requestAnimationFrame(sample)
        }),
      count,
    )
    expect(unclipped).toBe(true)
    await expect(cards).toHaveCount(count)
    await expect(grid.locator('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'false',
    )
    await expect.poll(chromeHeight).toBeCloseTo(fixedHeight, 0)
    const headingAfter = (await heading.boundingBox())!
    expect(Math.abs(headingAfter.y - headingBefore.y)).toBeLessThan(1)
  }
  await expect(
    grid.getByRole('button', { name: 'Load more agents' }),
  ).toHaveCount(0)
})

test('clipped descriptions stay inside cards and open independently of agent selection', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat&noAgent&longDescriptions')
  const card = page.getByRole('button', { name: /^Agent 1 / })
  await page.getByRole('button', { name: /^Agent 0 / }).hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 720 })
    await expect
      .poll(() =>
        card.getByText(/^A VERY/).evaluate((text) => {
          const button = text.closest('button')!
          const bounds = text.getBoundingClientRect()
          const cardBounds = button.getBoundingClientRect()
          return (
            text.scrollHeight > text.clientHeight &&
            bounds.bottom < cardBounds.bottom &&
            bounds.right < cardBounds.right
          )
        }),
      )
      .toBe(true)
    await card.hover()
    const popover = page.getByRole('tooltip')
    await expect(popover).toBeVisible()
    await expect(popover).toContainText('Description ends here.')
    const bounds = (await popover.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
    await expect(card).toBeEnabled()
  }
  await card.click()
  await expect(
    page.getByText('A few ways to get going with Agent 1.'),
  ).toBeVisible()
})

test('holding an agent card reveals its description without selecting it on release', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: { width: 320, height: 720 },
  })
  try {
    const page = await context.newPage()
    await page.goto('/?fixture=empty-chat&noAgent&longDescriptions')
    const card = page.getByRole('button', { name: /^Agent 1 / })
    await card.scrollIntoViewIfNeeded()
    await card.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 1,
      button: 0,
    })
    await expect(page.getByRole('tooltip')).toContainText(
      'Description ends here.',
    )
    await card.dispatchEvent('pointerup', {
      pointerType: 'touch',
      pointerId: 1,
    })
    await card.dispatchEvent('click')
    await expect(
      page.getByRole('region', { name: 'Choose an agent' }),
    ).toBeVisible()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await card.tap()
    await expect(
      page.getByText('A few ways to get going with Agent 1.'),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})

test('starters fill the composer, disable during drafting, and switching preserves the draft', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat')
  const editor = page.locator('[contenteditable="true"]').first()
  await page.getByRole('button', { name: 'Improve a draft' }).click()
  await expect(editor).toHaveText('Help me improve this draft:')
  await expect(
    page.getByRole('button', { name: 'Improve a draft' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('heading', { name: 'What’s on your mind?' }),
  ).toBeVisible()
  expect(new URL(page.url()).searchParams.has('id')).toBe(false)
  await page.getByRole('button', { name: 'Choose another agent' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Search agents' }),
  ).toBeVisible()
  await expect(editor).toHaveText('Help me improve this draft:')
  await page.getByRole('button', { name: /^Agent 1 / }).click()
  await expect(
    page.getByText('A few ways to get going with Agent 1.'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Improve a draft' }),
  ).toBeDisabled()
  await editor.press('ControlOrMeta+A')
  await editor.press('Backspace')
  await expect(
    page.getByRole('button', { name: 'Improve a draft' }),
  ).toBeEnabled()
  await editor.fill('   ')
  await expect(
    page.getByRole('button', { name: 'Improve a draft' }),
  ).toBeEnabled()
})

test('agent selection keeps the ripple centered and the pressed card still until the welcome fades out', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat&noAgent&deferSelection')
  const card = page.getByRole('button', { name: /^Agent 3 / })
  await card.click({ trial: true })
  await card.evaluate((button) => {
    button.addEventListener(
      'pointerdown',
      (event) => {
        if (!(event instanceof PointerEvent)) return
        const { clientX, clientY } = event
        const original = button.getBoundingClientRect()
        let frames = 0
        let centerError = 0
        let movement = 0
        function sample() {
          const ripple = button.querySelector(
            ':scope > span.pointer-events-none',
          )
          const bounds = ripple?.getBoundingClientRect()
          if (bounds && bounds.width > 0) {
            centerError = Math.max(
              centerError,
              Math.hypot(
                bounds.x + bounds.width / 2 - clientX,
                bounds.y + bounds.height / 2 - clientY,
              ),
            )
          }
          const position = button.getBoundingClientRect()
          movement = Math.max(
            movement,
            Math.hypot(position.x - original.x, position.y - original.y),
          )
          button.dataset.rippleFrames = String(++frames)
          button.dataset.rippleCenterError = String(centerError)
          button.dataset.cardMovement = String(movement)
          if (frames < 16) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      },
      { once: true },
    )
  })
  const bounds = (await card.boundingBox())!
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height * 0.6,
  )
  await page.mouse.down()
  await expect
    .poll(() => card.getAttribute('data-ripple-frames').then(Number))
    .toBeGreaterThanOrEqual(3)
  await page.mouse.up()
  await expect(card).toBeDisabled()
  await expect(card).toHaveAttribute('data-ripple-frames', '16')
  expect(
    Number(await card.getAttribute('data-ripple-center-error')),
  ).toBeLessThan(1)
  expect(Number(await card.getAttribute('data-card-movement'))).toBeLessThan(1)

  const inertWhileExiting = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const grid = document.querySelector(
          'section[aria-label="Choose an agent"]',
        )!
        const observer = new MutationObserver(() => {
          if (grid.closest('[inert]')) {
            observer.disconnect()
            resolve(true)
          } else if (!grid.isConnected) {
            observer.disconnect()
            resolve(false)
          }
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['inert'],
        })
        window.dispatchEvent(new Event('complete-selection'))
      }),
  )
  expect(inertWhileExiting).toBe(true)
  await expect(
    page.getByText('A few ways to get going with Agent 3.'),
  ).toBeVisible()
  await expect(
    page.locator('section[aria-label="Choose an agent"]'),
  ).toHaveCount(0)
})

test('failed agent selection re-enables the cards', async ({ page }) => {
  await page.goto('/?fixture=empty-chat&noAgent&failSelection')
  const card = page.getByRole('button', { name: /^Agent 3 / })
  await card.click()
  await expect(card).toBeEnabled()
  await expect(page.getByRole('button', { name: /^Agent 0/ })).toBeEnabled()
})

test('project suggestions require a source and reading capability', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat&folder=workspace')
  await expect(
    page.getByRole('button', { name: 'Explore the project' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Plan a change' }).click()
  await expect(
    page.getByRole('button', { name: 'Disable plan mode' }),
  ).toBeVisible()
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText(
    'Help me plan this change:',
  )
  await page.goto('/?fixture=empty-chat&folder=workspace&organizationOnly')
  await expect(
    page.getByRole('button', { name: 'Work with a file' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Explore the project' }),
  ).toHaveCount(0)
  await page.goto('/?fixture=empty-chat&folder=workspace&noReadTools')
  await expect(
    page.getByRole('button', { name: 'Work with a file' }),
  ).toBeVisible()
})

test('restored drafts disable task cards and delayed settings do not flash setup', async ({
  page,
}) => {
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          '@new-chat': { text: 'Recovered draft', updatedAt: Date.now() },
        }),
      ),
    `${APP_ID}-composer-drafts`,
  )
  await page.goto('/?fixture=empty-chat&slowWelcome')
  await expect(page.locator('[contenteditable="true"]').first()).toHaveText(
    'Recovered draft',
  )
  await expect(
    page.getByRole('heading', { name: 'Connect a model provider' }),
  ).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('resolve-welcome')))
  await expect(
    page.getByRole('heading', { name: 'What’s on your mind?' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Improve a draft' }),
  ).toBeDisabled()
})

test('file starter uses existing upload flow and attachments disable task cards', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Work with a file' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Review these notes.'),
  })
  await expect(
    page.getByText('notes.txt', { exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Work with a file' }),
  ).toBeDisabled()
  await expect(page.locator('[contenteditable="true"]').first()).toBeFocused()
})

test('empty and unmatched agent libraries offer useful next steps', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat&noAgent')
  await page.getByRole('textbox', { name: 'Search agents' }).fill('nonexistent')
  await expect(page.getByText('No agents match your search.')).toBeVisible()
  await page.goto('/?fixture=empty-chat&noAgent&emptyAgents')
  await page.getByRole('button', { name: 'Create an agent' }).click()
  expect(new URL(page.url()).searchParams.get('view')).toBe('agent:profile')
})

test('welcome and expanded agent cards fit narrow and short viewports', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?fixture=empty-chat&noAgent&longNames')
  await page.getByRole('button', { name: 'View all agents' }).click()
  const longCard = page.getByRole('button', { name: /^VeryLongAgentName/ })
  const cardSizes = await page
    .getByRole('region', { name: 'Choose an agent' })
    .getByRole('button', { name: /^(Agent \d|VeryLongAgentName)/ })
    .evaluateAll((cards) =>
      cards.map((card) => {
        const { width, height } = card.getBoundingClientRect()
        return { width, height }
      }),
    )
  expect(cardSizes.length).toBeGreaterThan(4)
  for (const size of cardSizes) {
    expect(size).toEqual(cardSizes[0]!)
  }
  await longCard.scrollIntoViewIfNeeded()
  await expect(longCard).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await longCard.click()
  await expect(
    page.getByRole('button', { name: 'Choose another agent' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
