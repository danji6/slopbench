import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=skills')
})

test('descriptions expand from two lines and the library scrolls beyond its first page', async ({
  page,
}) => {
  const description = page
    .getByText('A deliberately long skill description', { exact: false })
    .first()
  await expect(description).toHaveCSS('-webkit-line-clamp', '2')
  await page.getByRole('button', { name: 'Show more' }).first().click()
  await expect(description).not.toHaveCSS('-webkit-line-clamp', '2')
  await page.getByRole('button', { name: 'Show less' }).first().click()
  const library = page.getByLabel('Add skills', { exact: true })
  await expect(library.getByText('skill-00', { exact: true })).toHaveCount(0)
  for (let i = 0; i < 12; i++) {
    await library.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    if (await library.getByText('skill-84', { exact: true }).count()) break
    await page.waitForTimeout(150)
  }
  await expect(library.getByText('skill-84', { exact: true })).toBeVisible()
})

test('busy feedback and Add buttons stay stable during delayed operation handoffs', async ({
  page,
}) => {
  const add = page.getByRole('button', { name: 'Add', exact: true }).first()
  await add.click()
  for (let i = 0; i < 10; i++) {
    await expect(page.getByText('Updating files…').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Add', exact: true }).first(),
    ).toBeDisabled()
    await page.waitForTimeout(80)
  }
  await expect(page.getByText('Updating files…')).toHaveCount(0)
  await expect(
    page
      .getByLabel('Add skills', { exact: true })
      .getByText('skill-01', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page
      .getByLabel('Remove skills', { exact: true })
      .getByText('skill-01', { exact: true }),
  ).toBeVisible()
})

test('errors are brief, dismissible, and do not return after changing tabs', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Fail next operation' }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  await expect(
    page.getByText('Fixture operation failed', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Uncaught ConvexError', { exact: false }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Dismiss error' }).click()
  await page.getByRole('button', { name: 'Skill library', exact: true }).click()
  await page
    .getByRole('button', { name: 'Agent settings', exact: true })
    .click()
  await expect(page.getByText('Fixture operation failed')).toHaveCount(0)
})

test('retry holds busy while the previous failed query is replaced', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Fail next operation' }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  for (let i = 0; i < 8; i++) {
    await expect(page.getByText('Updating files…').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Add', exact: true }).first(),
    ).toBeDisabled()
    await page.waitForTimeout(80)
  }
  await expect(page.getByText('Updating files…')).toHaveCount(0)
  await expect(page.getByText('Fixture operation failed')).toHaveCount(0)
})

test('an unassigned folder has no managed label and selecting its first folder needs no change confirmation', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Choose directory', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Use this folder', exact: true })
    .click()
  await expect(
    page.getByText('Change personal folder?', { exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText('Updating files…')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Detach folder', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Inspect last operation' }).click()
  await expect(page.getByLabel('Last operation')).toContainText(
    '"copyFiles":false',
  )
})

test('folder status waits for disk inspection and detects a folder removed outside the app', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.getByText('Checking personal folder…')).toBeVisible()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toHaveCount(0)
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Remove fixture folder on disk' })
    .click()
  await expect(
    page.getByText('The assigned folder is missing.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Recreate folder', exact: true })
    .click()
  await expect(page.getByText('Updating files…')).toBeVisible()
  await expect(
    page.getByText("This agent's folder is being managed by the app."),
  ).toBeVisible()
})

test('managed folders can be detached with optional deletion, while custom folders are preserved', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Detach folder', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Delete files', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Keep files', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Inspect last operation' }).click()
  await expect(page.getByLabel('Last operation')).toContainText(
    '"removeFolder":false',
  )
  await page
    .getByRole('button', { name: 'Assign custom fixture folder' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Use managed folder', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Delete folder', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Detach folder', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Delete files', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText('The files will be preserved', { exact: false }),
  ).toBeVisible()
})

test('delete folder explicitly detaches and removes a managed folder', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click()
  await expect(
    page.getByText('Delete personal folder?', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Delete folder', exact: true })
    .last()
    .click()
  await expect(
    page.getByRole('button', { name: 'Initialize folder', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Inspect last operation' }).click()
  await expect(page.getByLabel('Last operation')).toContainText(
    '"removeFolder":true',
  )
})

test('managed detach dialog keeps action labels inside their buttons', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Assign managed fixture folder' })
    .click()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Detach folder', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()

  for (const width of [760, 320, 220]) {
    await page.setViewportSize({ width, height: 600 })
    await expect
      .poll(() =>
        dialog.getByRole('button').evaluateAll((buttons) =>
          buttons.every((button) => {
            const box = button.getBoundingClientRect()
            const walker = document.createTreeWalker(
              button,
              NodeFilter.SHOW_TEXT,
            )
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent?.trim()) continue
              const range = document.createRange()
              range.selectNodeContents(walker.currentNode)
              const fits = Array.from(range.getClientRects()).every(
                (rect) =>
                  rect.left >= box.left &&
                  rect.right <= box.right &&
                  rect.top >= box.top &&
                  rect.bottom <= box.bottom,
              )
              if (!fits) return false
            }
            return button.scrollWidth <= button.clientWidth
          }),
        ),
      )
      .toBe(true)
    if (width === 320) {
      await page.screenshot({ path: '/tmp/slopbench-detach-dialog.png' })
    }
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Detach folder', exact: true }),
  ).toBeEnabled()
})
