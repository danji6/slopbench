import { type Page, expect, test } from '@playwright/test'

const picker = (page: Page) =>
  page.locator('[data-slot="tool-approval-picker"]')
const note = (page: Page) => picker(page).locator('[contenteditable="true"]')

async function mutations(page: Page) {
  return JSON.parse(
    (await page.getByTestId('approval-mutations').textContent()) ?? '[]',
  ) as {
    name: string
    args: Record<string, unknown>
  }[]
}

async function resolveApproval(page: Page) {
  await page
    .getByRole('button', { name: 'Resolve approval', exact: true })
    .click()
}

test('approves locally with a note and keeps the parent queue synchronized', async ({
  page,
}) => {
  await page.goto('/?fixture=subagent-approvals&id=child')
  await expect(picker(page)).toBeVisible()
  await expect(picker(page)).toContainText('git push origin first')
  await expect(picker(page)).not.toContainText('git push origin sibling')
  await expect(page.locator('[data-slot="subagent-banner"]')).toBeVisible()
  await note(page).fill('Use the test remote')
  await note(page).press('ControlOrMeta+Enter')
  await expect(picker(page)).toContainText('git push origin second')
  expect((await mutations(page))[0]).toEqual({
    name: 'chat:approveTool',
    args: {
      sessionId: 'parent',
      childSessionId: 'child',
      toolCallId: 'first',
      approved: true,
      note: 'Use the test remote',
    },
  })
  await resolveApproval(page)
  await page.getByRole('button', { name: 'View parent', exact: true }).click()
  await expect(picker(page)).toContainText('Sub-agent: Explore')
  await expect(picker(page)).toContainText('git push origin second')
  await picker(page).getByRole('option', { name: /^Deny/ }).click()
  await expect(picker(page)).toContainText('git push origin sibling')
  await resolveApproval(page)
  await page.getByRole('button', { name: 'View child', exact: true }).click()
  await expect(picker(page)).toHaveCount(0)
  expect((await mutations(page))[1].args).toMatchObject({
    sessionId: 'parent',
    childSessionId: 'child',
    toolCallId: 'second',
    approved: false,
  })
})

test('preserves child note drafts when moving between views', async ({
  page,
}) => {
  await page.goto('/?fixture=subagent-approvals&id=child')
  await note(page).fill('Shared child note')
  // Wait for the existing debounced draft autosave before leaving the editor.
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('slopbench-composer-drafts')),
    )
    .toContain('Shared child note')
  await page.getByRole('button', { name: 'View parent', exact: true }).click()
  await expect(note(page)).toHaveText('Shared child note')
  await page.getByRole('button', { name: 'View child', exact: true }).click()
  await expect(note(page)).toHaveText('Shared child note')
})

test('remembers a local approval through the shared parent policy', async ({
  page,
}) => {
  await page.goto('/?fixture=subagent-approvals&id=child')
  await picker(page)
    .getByRole('option', { name: /for this session/ })
    .click()
  await expect(picker(page)).toContainText('git push origin second')
  expect((await mutations(page))[0].args).toMatchObject({
    sessionId: 'parent',
    childSessionId: 'child',
    toolCallId: 'first',
    approved: true,
    remember: 'patterns',
  })
  await resolveApproval(page)
})

test('aborts only the viewed child', async ({ page }) => {
  await page.goto('/?fixture=subagent-approvals&id=child')
  await picker(page)
    .getByRole('option', { name: /^Abort/ })
    .click()
  await expect(picker(page)).toHaveCount(0)
  expect((await mutations(page))[0]).toEqual({
    name: 'chat:stopStream',
    args: { sessionId: 'child' },
  })
  await page.getByRole('button', { name: 'View parent', exact: true }).click()
  await expect(picker(page)).toContainText('git push origin sibling')
})

test('restores the request and note after an approval fails', async ({
  page,
}) => {
  await page.goto('/?fixture=subagent-approvals&id=child')
  await page
    .getByRole('button', { name: 'Fail next approval', exact: true })
    .click()
  await note(page).fill('Retain this note')
  await note(page).press('ControlOrMeta+Enter')
  await expect(picker(page)).toContainText('git push origin second')
  await resolveApproval(page)
  await expect(picker(page)).toContainText('git push origin first')
  await expect(note(page)).toHaveText('Retain this note')
})

test('keeps approval controls unavailable to non-admins', async ({ page }) => {
  await page.goto('/?fixture=subagent-approvals&id=child&nonAdmin')
  await expect(page.locator('[data-slot="subagent-banner"]')).toBeVisible()
  await expect(picker(page)).toHaveCount(0)
})
