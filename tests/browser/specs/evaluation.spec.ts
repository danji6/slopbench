import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Preview')).toHaveText('Fixture user')
})

test('bundled worker evaluates without host access', async ({ page }) => {
  await page
    .getByLabel('Prompt')
    .fill(
      '{{ [typeof process, typeof fetch, typeof document, typeof self, readFile.constructor("return typeof fetch")()] }}',
    )
  await expect(page.getByLabel('Preview')).toHaveText(
    '["undefined","undefined","undefined","undefined","undefined"]',
  )
})

test('unbounded evaluation cannot block browser interaction', async ({
  page,
}) => {
  await page.getByLabel('Prompt').fill('#eval\nwhile (true) {}\n#end')
  await page.getByRole('button').click()
  await expect(page.getByRole('button')).toHaveText('Respond 1')
  await expect(page.getByLabel('Preview')).toHaveText(
    'Prompt preview could not be evaluated.',
  )
})

test('a changed prompt cancels and replaces the previous result', async ({
  page,
}) => {
  await page.getByLabel('Prompt').fill('#eval\nwhile (true) {}\n#end')
  await page.getByLabel('Prompt').fill('{{ 40 + 2 }}')
  await expect(page.getByLabel('Preview')).toHaveText('42')
})

test('failures surface and a subsequent edit recovers', async ({ page }) => {
  await page.getByLabel('Prompt').fill('{{ missing() }}')
  await expect(page.getByLabel('Preview')).toHaveText(
    'Prompt preview could not be evaluated.',
  )
  await page
    .getByLabel('Prompt')
    .fill('{{ readFile("/etc/passwd") || "No filesystem" }}')
  await expect(page.getByLabel('Preview')).toHaveText('No filesystem')
})
