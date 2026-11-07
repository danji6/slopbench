import { type Locator, type Page, expect, test } from '@playwright/test'

test('opening a long summary at the bottom brings its start below the nav', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 600 })
  await page.goto('/?fixture=notes&id=notes&compaction&longSummary')
  const summary = page.getByRole('button', { name: /^Summary\b/ })
  await expect(summary).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          scrollY > 0 &&
          document.documentElement.scrollHeight - scrollY - innerHeight <= 1,
      ),
    )
    .toBe(true)
  expect((await summary.boundingBox())!.y).toBeGreaterThan(120)

  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await expect
    .poll(async () => (await summary.boundingBox())?.y ?? Infinity)
    .toBeLessThan(120)
  const nav = (await page.getByRole('navigation').boundingBox())!
  expect((await summary.boundingBox())!.y).toBeGreaterThanOrEqual(
    nav.y + nav.height,
  )
})

for (const mixed of [false, true]) {
  test(`work sums thinking durations and reveals every thinking block (mixed=${mixed})`, async ({
    page,
  }) => {
    await page.goto(
      `/?fixture=notes&id=notes&thinkingWork${mixed ? '&mixedThinking' : ''}`,
    )
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toHaveText(
      mixed ? 'Read 1 file, thought for 1m12s' : 'Thought for 1m12s',
      { useInnerText: true },
    )
    await expect(
      page.locator('[data-slot="reasoning-highlight"]'),
    ).toContainText('Thought for 1m2s')
    await expect(page.locator('[data-slow="message-footer"]')).toContainText(
      '2m26s',
    )
    const blocks = page.locator('[data-slot="reasoning-block"]')
    await expect(blocks).toHaveCount(0)
    await work.click()
    await expect(blocks).toHaveCount(2)
    await expect(blocks.nth(0)).toContainText('Thought for 10.0s')
    await expect(blocks.nth(1)).toContainText('Thought for 1m2s')
    await blocks.nth(0).getByRole('button').click()
    await blocks.nth(1).getByRole('button').click()
    await expect(blocks.nth(0)).toContainText('First thinking block.')
    await expect(blocks.nth(1)).toContainText('Second thinking block.')
    await work.click()
    await expect(blocks).toHaveCount(0)
    await work.click()
    await expect(blocks.nth(0).getByText('First thinking block.')).toBeVisible()
    await expect(
      blocks.nth(1).getByText('Second thinking block.'),
    ).toBeVisible()
  })
}

test('compaction keeps a smaller incoming gap and separates thinking from its summary', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&compaction')
  const command = page.locator('[data-row-key="hid:command"]')
  const thinking = page.locator('[data-slot="reasoning-block"]')
  const summary = page.locator('[data-slot="summary-block"]').first()
  await expect(thinking).toBeVisible()
  const commandBox = await command.boundingBox()
  const thinkingBox = await thinking.boundingBox()
  expect(thinkingBox!.y - commandBox!.y - commandBox!.height).toBe(20)
  for (const expanded of [true, false]) {
    await thinking.getByRole('button').click()
    await expect(thinking).toHaveAttribute('data-open', String(expanded))
    await expect
      .poll(async () => {
        const above = await thinking.boundingBox()
        const below = await summary.boundingBox()
        return below!.y - above!.y - above!.height
      })
      .toBe(8)
  }
})

async function showShellAtBottom(page: Page, height: number) {
  await page.setViewportSize({ width: 1100, height })
  await page.goto('/?fixture=notes&id=notes&fileChanges&longShell')
  await page.locator('[data-slot="work-block"]').click()
  await expect(
    page.locator('[data-slot="virtualized-row-transition"][data-state]'),
  ).toHaveCount(0)
  const shell = page.locator('[data-slot="shell-block"]')
  const trigger = shell.locator('[data-block-trigger]')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
        return document.documentElement.scrollHeight - scrollY - innerHeight
      }),
    )
    .toBeLessThanOrEqual(1)
  await expect(trigger).toBeInViewport({ ratio: 1 })
  return { shell, trigger }
}

test('opening a shell command scrolls only enough to reveal its output', async ({
  page,
}) => {
  const height = 760
  const { shell, trigger } = await showShellAtBottom(page, height)
  // Leave room to scroll farther than necessary after revealing the output.
  await page.locator('main').evaluate((main) => {
    main.style.paddingBottom = '100vh'
  })
  await page.evaluate(() => {
    // Apply the requested distance immediately so the test measures its destination.
    const scrollBy = window.scrollBy.bind(window)
    window.scrollBy = (options?: ScrollToOptions | number, y?: number) => {
      if (typeof options === 'object') {
        scrollBy({ ...options, behavior: 'instant' })
        if (options.behavior === 'smooth') {
          document.documentElement.dataset.shellReveal = 'done'
        }
      } else {
        scrollBy(options ?? 0, y ?? 0)
      }
    }
  })

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('html')).toHaveAttribute(
    'data-shell-reveal',
    'done',
  )
  const terminal = shell.locator('[data-slot="terminal-wrapper"]')
  const output = (await terminal.boundingBox())!
  expect(output.y + output.height).toBeLessThanOrEqual(height - 80)
  expect((await trigger.boundingBox())!.y).toBeGreaterThan(140)
})

test('a live shell waiting for input still reveals the terminal automatically', async ({
  page,
}) => {
  const { shell, trigger } = await showShellAtBottom(page, 760)
  await page.getByRole('button', { name: 'Wait for terminal input' }).click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const terminal = shell.locator('[data-slot="terminal-wrapper"]')
  await expect
    .poll(async () => {
      const box = await terminal.boundingBox()
      return box ? box.y + box.height : Infinity
    })
    .toBeLessThanOrEqual(680)
  expect((await trigger.boundingBox())!.y).toBeGreaterThan(120)
})

test('file changes share a list with independent, persistent diff toggles', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&fileChanges')
  const work = page.locator('[data-slot="work-block"]')
  await work.click()
  await expect(
    page.locator('[data-slot="virtualized-row-transition"][data-state]'),
  ).toHaveCount(0)
  const group = page.locator('[data-slot="file-change-group"]')
  await expect(group).toContainText('Changed 3 files')
  const rows = group.getByRole('listitem')
  await expect(rows).toHaveCount(3)
  const first = rows.nth(0)
  const second = rows.nth(1)
  await expect(first.locator('[data-slot="code-container"]')).toBeHidden()
  await expect(second.locator('[data-slot="code-container"]')).toBeHidden()
  await expect(rows.nth(2)).toContainText('Original text was not found')

  await first.getByRole('button', { name: 'first.ts' }).focus()
  await page.keyboard.press('Enter')
  await expect(first.locator('[data-slot="code-container"]')).toBeVisible()
  await expect(first).toContainText('newFirst')
  await expect(second.getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await second.getByRole('button', { name: 'second.ts' }).click()
  await expect(second.locator('[data-slot="code-container"]')).toBeVisible()
  await expect(second).toContainText('newSecond')
  await first.getByRole('button', { name: 'first.ts' }).click()
  await expect(first.locator('[data-slot="code-container"]')).toBeHidden()
  await expect(first.getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(second.getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  await work.click()
  await expect(group).toBeHidden()
  await work.click()
  await expect(second.getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(second).toContainText('newSecond')
  await expectEvenInset(
    second.locator('[data-slot="file-change-block"]'),
    '[data-slot="code-container"]',
  )
  const shell = page.locator('[data-slot="shell-block"]')
  await expectMatchingTreeInset(shell, group)
  await shell.getByRole('button').click()
  await expect(shell.locator('[data-slot="terminal-wrapper"]')).toBeVisible()
  await expectEvenInset(shell, '[data-slot="terminal-wrapper"]')
  await expectMatchingTreeInset(shell, group)
  await shell.getByRole('button').click()
  await expect(shell.locator('[data-slot="terminal-wrapper"]')).toBeHidden()
  await expectMatchingTreeInset(shell, group)
})

for (const grouped of [true, false]) {
  test(`shell commands and reports share shell groups (grouped=${grouped})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1200 })
    await page.goto(
      `/?fixture=notes&id=notes&shellReports${grouped ? '' : '&ungrouped'}`,
    )
    await expect(page.locator('[data-slot="message-header"]')).toHaveCount(
      grouped ? 2 : 4,
    )
    const report = page.locator(
      '[data-slot="message-row"][data-message-id="shell2"]',
    )
    await expect(
      report.locator('[data-slot="shell-report-block"]'),
    ).toHaveCount(0)
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toHaveCount(grouped ? 2 : 3)
    await expect(work.first()).toContainText('Ran 2 commands')
    for (const block of await work.all()) await block.click()
    await expect(
      page.locator('[data-slot="virtualized-row-transition"][data-state]'),
    ).toHaveCount(0)
    await expect(report.first()).toHaveAttribute('data-role', 'assistant')

    const groups = page.locator('[data-slot="shell-group"]')
    await expect(groups).toHaveCount(3)
    await expect(groups.nth(0)).toContainText('Ran 1 command')
    await expect(groups.nth(1)).toContainText('Ran 2 commands')
    await expect(groups.nth(2)).toContainText('Ran 1 command')
    const commandTriggers = groups.nth(1).locator('[data-block-trigger]')
    await expect(commandTriggers.first().locator('.shiki .line')).toBeVisible()
    await commandTriggers.first().focus()
    await page.keyboard.press('Tab')
    await expect(commandTriggers.nth(1)).toBeFocused()
    const output = page.locator('[data-tool-call-id="poll"]')
    const nextOutput = page.locator('[data-tool-call-id="poll-next"]')
    await expect(output.getByRole('button')).toHaveText(
      'Read output of job job',
      { useInnerText: true },
    )
    await expect(nextOutput.getByRole('button')).toHaveText(
      'Read output of job next-job',
      { useInnerText: true },
    )
    await expect(
      output.getByText('Command output', { exact: true }),
    ).toBeHidden()
    await output.getByRole('button').focus()
    await page.keyboard.press('Enter')
    await expect(
      output.getByText('Command output', { exact: true }),
    ).toBeVisible()
    await nextOutput.getByRole('button').click()
    await expect(nextOutput.getByText('Next command output')).toBeVisible()
    await output.getByRole('button').click()
    await expect(
      output.getByText('Command output', { exact: true }),
    ).toBeHidden()
    await expect(nextOutput.getByText('Next command output')).toBeVisible()
    await expect(groups.nth(0)).toContainText('user output')
    await expect(groups.nth(2).getByText('Lint passed')).toBeHidden()
    await groups.nth(2).getByRole('button').click()
    await expect(groups.nth(2).getByText('Lint passed')).toBeVisible()
    if (grouped) {
      await expect
        .poll(async () => {
          const reportBox = await groups.nth(2).boundingBox()
          const progressBox = await page
            .getByText('Agent progress', { exact: true })
            .boundingBox()
          return reportBox && progressBox
            ? progressBox.y - reportBox.y - reportBox.height
            : Infinity
        })
        .toBeLessThanOrEqual(24)
    }
    await work.first().click()
    if (grouped) {
      await expect(
        report.locator('[data-slot="shell-report-block"]'),
      ).toHaveCount(0)
      await expect(work.first()).toContainText('Ran 2 commands')
      await page.getByRole('button', { name: 'Seek report' }).click()
      await expect(work.first()).toHaveAttribute('aria-expanded', 'true')
      await expect(
        report.locator('[data-slot="shell-report-block"]'),
      ).toBeVisible()
    }
    await expect(
      page.locator(
        '[data-slot="shell-block"]:not([data-slot="shell-group"] *)',
      ),
    ).toHaveCount(2)
    if (grouped) {
      await expect(page.locator('[data-slow="message-footer"]')).toHaveCount(1)
      await expect(page.locator('[data-slow="message-footer"]')).toContainText(
        '2m26s',
      )
    }
  })
}

for (const emptyChanges of [false, true]) {
  test(`completed grouped messages leave no blank space between collapsed work summaries (emptyChanges=${emptyChanges})`, async ({
    page,
  }) => {
    await page.goto(
      `/?fixture=notes&id=notes&groupedWork${emptyChanges ? '&emptyChanges' : ''}`,
    )
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toHaveCount(2)
    await expect
      .poll(async () => {
        const first = await work.nth(0).boundingBox()
        const second = await work.nth(1).boundingBox()
        return first && second ? second.y - first.y - first.height : Infinity
      })
      .toBeLessThanOrEqual(1)
  })
}

test('releases footer height when its duration disappears', async ({
  page,
}) => {
  await page.goto('/?fixture=notes&id=notes&groupedWork')
  const footer = page.locator('[data-row-kind="footer"]')
  await expect(footer.locator('[data-slow="message-footer"]')).toBeVisible()
  await expect
    .poll(async () => (await footer.boundingBox())?.height ?? 0)
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Hide duration' }).click()
  await expect(footer.locator('[data-slow="message-footer"]')).toHaveCount(0)
  await expect
    .poll(async () => (await footer.boundingBox())?.height ?? Infinity)
    .toBeLessThanOrEqual(1)
})

test('opening work at the bottom holds the viewport, then reveals its details', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 530 })
  await page.goto('/?fixture=notes&id=notes&fileChanges&longShell')
  const work = page.locator('[data-slot="work-block"]')
  await expect(work).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight - innerHeight - scrollY,
      ),
    )
    .toBeLessThanOrEqual(1)

  const { start, frames } = await work.evaluate(async (button) => {
    const start = scrollY
    const frames: { y: number; opening: boolean }[] = []
    const deadline = performance.now() + 5000
    let stable = 0
    ;(button as HTMLButtonElement).click()
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      const opening = Boolean(
        document.querySelector(
          '[data-work-id] [data-slot="virtualized-row-transition"][data-state]',
        ),
      )
      const last = Array.from(document.querySelectorAll('[data-work-id]')).at(
        -1,
      )
      const bottom = last?.getBoundingClientRect().bottom ?? Infinity
      const revealed = !opening && bottom <= innerHeight - 80
      stable = revealed && frames.at(-1)?.y === scrollY ? stable + 1 : 0
      frames.push({ y: scrollY, opening })
      if (stable >= 5) return { start, frames }
    }
    throw new Error('The work details did not scroll into view')
  })

  const opening = frames.filter((frame) => frame.opening)
  expect(opening.length).toBeGreaterThan(0)
  expect(opening.every((frame) => Math.abs(frame.y - start) <= 1)).toBe(true)
  expect(
    frames.every((frame, i) => i === 0 || frame.y >= frames[i - 1].y - 1),
  ).toBe(true)
  expect(frames.at(-1)!.y).toBeGreaterThan(start + 20)
  const nav = (await page.getByRole('navigation').boundingBox())!
  expect((await work.boundingBox())!.y).toBeGreaterThanOrEqual(
    nav.y + nav.height,
  )
})

for (const finishOpening of [true, false]) {
  test(`collapsing work at the tail preserves position without bouncing (finishOpening=${finishOpening})`, async ({
    page,
  }) => {
    await page.goto('/?fixture=notes&id=notes&tailWork')
    const work = page.locator('[data-slot="work-block"]')
    await expect(work).toBeVisible()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let last = -1
          let stable = 0
          const tick = () => {
            const height = document.documentElement.scrollHeight
            window.scrollTo(0, height)
            stable = height === last ? stable + 1 : 0
            last = height
            if (stable >= 3) resolve()
            else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
    )
    await expect(work).toBeInViewport({ ratio: 1 })
    const originalY = await page.evaluate(() => window.scrollY)
    await work.evaluate((button) => (button as HTMLButtonElement).click())
    await expect(work).toHaveAttribute('aria-expanded', 'true')
    if (finishOpening) {
      await expect(
        page.locator('[data-slot="virtualized-row-transition"][data-state]'),
      ).toHaveCount(0)
    }

    const frames = await work.evaluate(
      (button) =>
        new Promise<Array<{ y: number; height: number }>>((resolve) => {
          const frames: Array<{ y: number; height: number }> = []
          const tick = () => {
            frames.push({
              y: window.scrollY,
              height: document.documentElement.scrollHeight,
            })
            if (frames.length < 45) requestAnimationFrame(tick)
            else resolve(frames)
          }
          button.addEventListener('click', () => requestAnimationFrame(tick), {
            once: true,
          })
          ;(button as HTMLButtonElement).click()
        }),
    )
    await expect(work).toHaveAttribute('aria-expanded', 'false')
    expect(Math.abs(frames.at(-1)!.y - originalY)).toBeLessThanOrEqual(1)
    expect(
      Math.max(...frames.map((frame) => Math.abs(frame.y - originalY))),
    ).toBeLessThanOrEqual(1)
  })
}

test('closing work at the expanded bottom waits for the rows to finish shrinking', async ({
  page,
}) => {
  await page.clock.install()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/?fixture=notes&id=notes&tailWork&singleEdit')
  const work = page.locator('[data-slot="work-block"]')
  const rows = page.locator('[data-work-id]')
  await work.evaluate((button) => (button as HTMLButtonElement).click())
  await expect(rows).toHaveCount(2)
  await expect(rows.getByRole('button', { expanded: false })).toHaveCount(2)
  await expect(
    rows.locator('[data-slot="virtualized-row-transition"][data-state]'),
  ).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const height = document.documentElement.scrollHeight
        window.scrollTo(0, height)
        return document.documentElement.scrollHeight - innerHeight - scrollY
      }),
    )
    .toBeLessThanOrEqual(1)
  await expect(work).toBeInViewport({ ratio: 1 })

  const closing = rows.locator(
    '[data-slot="virtualized-row-transition"][data-state="closing"]',
  )
  const paused = await pauseWorkCollapse(work)
  expect(paused).toBe(2)
  await page.clock.runFor(300)
  await expect(closing).toHaveCount(2)

  const { removalY, settledY, distanceFromBottom } =
    await finishWorkCollapse(closing)
  expect(distanceFromBottom).toBeLessThanOrEqual(1)
  expect(removalY).toBeGreaterThanOrEqual(settledY - 1)
})

async function pauseWorkCollapse(work: Locator) {
  return work.evaluate(async (button) => {
    ;(button as HTMLButtonElement).click()
    await new Promise(requestAnimationFrame)
    const closing = document.querySelectorAll('[data-state="closing"]')
    return [...closing].filter((row) => {
      const animations = row.getAnimations()
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = 50
      }
      return animations.length > 0
    }).length
  })
}

async function finishWorkCollapse(closing: Locator) {
  return closing.first().evaluate(async (row) => {
    const list = row.closest('[data-work-id]')!.parentElement!
    const removed = new Promise<number>((resolve) => {
      const observer = new MutationObserver(() => {
        if (list.querySelector('[data-work-id]')) return
        observer.disconnect()
        resolve(window.scrollY)
      })
      observer.observe(list, { childList: true })
    })
    for (const child of list.querySelectorAll('[data-state="closing"]')) {
      for (const animation of child.getAnimations()) animation.play()
    }
    const removalY = await removed
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return {
      removalY,
      settledY: window.scrollY,
      distanceFromBottom:
        document.documentElement.scrollHeight - innerHeight - scrollY,
    }
  })
}

/** Checks the visible inset and corner relationship after expansion settles. */
async function expectEvenInset(block: Locator, innerSelector: string) {
  await expect
    .poll(() =>
      block.evaluate((outer, selector) => {
        if (outer.getAnimations({ subtree: true }).length) return Infinity
        const inner = outer.querySelector(selector)!
        const outerBox = outer.getBoundingClientRect()
        const innerBox = inner.getBoundingClientRect()
        const left = innerBox.left - outerBox.left
        const right = outerBox.right - innerBox.right
        const bottom = outerBox.bottom - innerBox.bottom
        const outerRadius = parseFloat(
          getComputedStyle(outer).borderBottomLeftRadius,
        )
        const innerRadius = parseFloat(
          getComputedStyle(inner).borderBottomLeftRadius,
        )
        return Math.max(
          Math.abs(left - right),
          Math.abs(left - bottom),
          Math.abs(innerRadius - Math.max(0, outerRadius - left)),
        )
      }, innerSelector),
    )
    .toBeLessThanOrEqual(1)
}

/** Checks that shell surfaces clear the tree gutter by the same inset as files. */
async function expectMatchingTreeInset(shell: Locator, files: Locator) {
  const shellList = shell.locator('xpath=ancestor::ul[1]')
  const shellBox = await shell.boundingBox()
  const shellListBox = await shellList.boundingBox()
  const fileBox = await files.getByRole('listitem').first().boundingBox()
  const fileListBox = await files.getByRole('list').boundingBox()
  expect(shellBox).not.toBeNull()
  expect(shellListBox).not.toBeNull()
  expect(fileBox).not.toBeNull()
  expect(fileListBox).not.toBeNull()
  const inset = shellBox!.x - shellListBox!.x
  const fileInset = fileBox!.x - fileListBox!.x
  expect(inset).toBeGreaterThan(0)
  expect(Math.abs(inset - fileInset)).toBeLessThanOrEqual(1)
}
