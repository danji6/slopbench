import { type Locator, type Page, expect, test } from '@playwright/test'

const note = (page: Page, id: string) =>
  page.locator(`[data-slot="hidden-chip"][data-message-id="${id}"]`)
const group = (page: Page) => page.locator('[data-slot="note-group-block"]')

async function showGroup(page: Page) {
  await page.getByRole('button', { name: 'Group', exact: true }).click()
  await expect(group(page)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Group', exact: true }),
  ).toHaveAttribute('data-seek-settled', 'true')
}

async function waitForGroupAnimation(page: Page) {
  const transition = page
    .locator(
      '[data-note-group-id="notes:mcp"] [data-slot="virtualized-row-transition"]',
    )
    .first()
  await expect(transition).toBeVisible()
  await expect(transition).not.toHaveAttribute('data-state')
}

async function expectAligned(page: Page, key: string) {
  await expect
    .poll(() =>
      page
        .locator(`[data-row-key="${key}"]`)
        .evaluate((el) => Math.abs(el.getBoundingClientRect().top - 64)),
    )
    .toBeLessThan(2)
}

async function sampleExpansion(trigger: Locator, childrenSelector: string) {
  return trigger.evaluate(async (button, selector) => {
    const heights: number[] = []
    const mountedCounts: number[] = []
    ;(button as HTMLButtonElement).click()
    while (true) {
      await new Promise(requestAnimationFrame)
      const children = document.querySelectorAll(selector)
      const row = children[0]?.querySelector<HTMLElement>(
        '[data-slot="virtualized-row-transition"]',
      )
      if (!row) continue
      heights.push(row.getBoundingClientRect().height)
      mountedCounts.push(children.length)
      if (!row.dataset.state) return { heights, mountedCounts }
    }
  }, childrenSelector)
}

function expectHeightExpansion(heights: number[]) {
  const finalHeight = heights.at(-1)!
  expect(finalHeight).toBeGreaterThan(0)
  expect(heights[0]).toBeLessThan(1)
  expect(heights.some((height) => height > 1 && height < finalHeight - 1)).toBe(
    true,
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=notes&id=notes')
})

test('groups notes, expands independently with keyboard, and keeps state across virtualized remounts', async ({
  page,
}) => {
  await showGroup(page)
  await expect(group(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(note(page, 'workspace')).toHaveCount(0)
  await group(page).focus()
  await page.keyboard.press('Enter')
  await waitForGroupAnimation(page)
  const workspace = note(page, 'workspace').getByRole('button')
  await expect(workspace).toHaveAttribute('aria-expanded', 'false')
  await expect(note(page, 'workspace').locator('strong')).toHaveCount(0)
  await workspace.focus()
  await page.keyboard.press('Space')
  await expect(note(page, 'workspace').locator('strong')).toHaveText(
    'Workspace details',
  )
  await expect(note(page, 'workspace')).toContainText('<system-reminder>')
  await expect(note(page, 'skills').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await group(page).click()
  await group(page).click()
  await expect(note(page, 'workspace').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.getByRole('button', { name: 'Top', exact: true }).click()
  await expect(note(page, 'workspace')).toHaveCount(0)
  await showGroup(page)
  await expect(note(page, 'workspace').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.getByRole('button', { name: 'Append', exact: true }).click()
  await expect(group(page)).toHaveAccessibleName('Collapse 5 notes')
  await expect(note(page, 'workspace').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await note(page, 'extra').getByRole('button').click()
  await expect(note(page, 'extra')).toContainText('No content.')
})

test('seeks a non-first note, restores its position after reload, and can target the first note', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Seek workspace' }).click()
  await expect(group(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(note(page, 'workspace').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expectAligned(page, 'hid:workspace')
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.dispatchEvent(new Event('scroll'))
        return Object.values(localStorage).some((value) =>
          value.includes('"rowKey":"hid:workspace"'),
        )
      }),
    )
    .toBe(true)
  await page.reload()
  await expect(note(page, 'workspace').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expectAligned(page, 'hid:workspace')
  await page.getByRole('button', { name: 'Seek first' }).click()
  await expectAligned(page, 'hid:mcp')
  await expect(note(page, 'mcp')).toContainText('Content for mcp')
})

test('animates virtualized note rows on group expansion and collapse', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&extraNotes=500')
  await showGroup(page)
  const children = page.locator('[data-note-group-id="notes:mcp"]')
  const transition = children
    .first()
    .locator('[data-slot="virtualized-row-transition"]')
  const firstOpen = await sampleExpansion(
    group(page),
    '[data-note-group-id="notes:mcp"]',
  )
  expectHeightExpansion(firstOpen.heights)
  expect(Math.max(...firstOpen.mountedCounts)).toBeLessThan(504)
  await group(page).click()
  await expect(transition).toHaveAttribute('inert')
  await expect
    .poll(() =>
      transition.evaluate((element) => element.getAnimations().length),
    )
    .toBeGreaterThan(0)
  await expect(children).toHaveCount(0)
  const reopened = await sampleExpansion(
    group(page),
    '[data-note-group-id="notes:mcp"]',
  )
  expectHeightExpansion(reopened.heights)
  await expect(note(page, 'workspace').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('animates the work summary height on first open and after unmounting', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&work')
  await showGroup(page)
  const trigger = page.locator('[data-slot="work-block"]')
  const firstOpen = await sampleExpansion(trigger, '[data-work-id]')
  expectHeightExpansion(firstOpen.heights)
  await trigger.click()
  await expect(page.locator('[data-work-id]')).toHaveCount(0)
  const reopened = await sampleExpansion(trigger, '[data-work-id]')
  expectHeightExpansion(reopened.heights)
})

test('restores a collapsed header without expanding it', async ({ page }) => {
  await showGroup(page)
  await expectAligned(page, 'notes:mcp')
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.dispatchEvent(new Event('scroll'))
        return Object.values(localStorage).some((value) =>
          value.includes('"rowKey":"notes:mcp"'),
        )
      }),
    )
    .toBe(true)
  await page.reload()
  await expect(group(page)).toBeVisible()
  await expectAligned(page, 'notes:mcp')
  await expect(group(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(note(page, 'mcp')).toHaveCount(0)
})

test('loads an anchored window for a collapsed note and wraps content on narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?fixture=notes&id=notes&unloaded&readOnly')
  await page.getByRole('button', { name: 'Seek workspace' }).click()
  await expect(note(page, 'workspace').locator('strong')).toHaveText(
    'Workspace details',
  )
  await expectAligned(page, 'hid:workspace')
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await note(page, 'workspace').click({ button: 'right' })
  await expect(page.getByRole('menu')).toHaveCount(0)
  await note(page, 'workspace').getByRole('button').click()
  await expect(note(page, 'workspace').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('shows command details and retains copy and confirmed deletion actions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          localStorage.setItem('copied-note', text)
        },
      },
    })
  })
  await page.reload()
  await showGroup(page)
  await group(page).click()
  await waitForGroupAnimation(page)
  await note(page, 'command').getByRole('button').click()
  await expect(note(page, 'command')).toContainText('Status: failed')
  await expect(note(page, 'command')).toContainText('Command failed')
  await note(page, 'command').evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    )
  })
  await note(page, 'command').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy Content' }).click()
  expect(await page.evaluate(() => localStorage.getItem('copied-note'))).toBe(
    '/timeout 30',
  )
  await note(page, 'workspace').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy Content' }).click()
  expect(
    await page.evaluate(() => localStorage.getItem('copied-note')),
  ).toContain('<system-reminder>')
  await note(page, 'workspace').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(note(page, 'workspace')).toBeVisible()
  await note(page, 'workspace').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(note(page, 'workspace')).toHaveCount(0)
  await expect(group(page)).toHaveAccessibleName('Collapse 3 notes')
})

test('Delete all removes later messages and leaves the earlier note as a singleton', async ({
  page,
}) => {
  await showGroup(page)
  await group(page).click()
  await waitForGroupAnimation(page)
  await note(page, 'workspace').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Delete all', exact: true }).click()
  await expect(group(page)).toHaveCount(0)
  await expect(note(page, 'mcp')).toBeVisible()
  await expect(note(page, 'workspace')).toHaveCount(0)
  await note(page, 'mcp').getByRole('button').click()
  await expect(note(page, 'mcp')).toContainText('Content for mcp')
})
