import { expect, test } from '@playwright/test'

test('provider edits use global save and only manual refresh failures are displayed', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  await page.getByLabel('Unrelated setting').fill('Unsaved global edit')
  await page.getByText('Personal API', { exact: true }).click()
  await page
    .getByRole('button', { name: 'Enable New discovered model' })
    .click()
  await expect(page.getByLabel('Global saved value')).toHaveText('')
  await expect(
    page.getByRole('button', { name: 'Save connection', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Simulate discovery failure' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh models' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Cached models are preserved',
  )
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Global saved value')).toHaveText(
    'Unsaved global edit',
  )
  await page.getByText('Select model…', { exact: true }).click()
  await page
    .getByRole('option', { name: 'New discovered model', exact: true })
    .click()
  await expect(page.getByLabel('Selected reference')).toHaveText(
    'sb-model:personal:new',
  )
})

test('global cancel discards new providers and unsaved edits', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  await page.getByRole('button', { name: 'Add connection' }).click()
  await page.getByPlaceholder('e.g. OpenAI').last().fill('Work API')
  await page.getByText('Select provider…', { exact: true }).click()
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click()
  await expect(page.getByLabel('Saved connection count')).toHaveText('1')
  await page.getByRole('button', { name: 'Cancel settings' }).click()
  await expect(page.getByText('Work API', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Personal API', { exact: true })).toBeVisible()
})

test('new ChatGPT connections expose sign-in before saving and stay expanded', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  await page.getByRole('button', { name: 'Add connection' }).click()
  await page.getByText('Select provider…', { exact: true }).click()
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click()
  await page.getByText('API key', { exact: true }).first().click()
  await page
    .getByRole('option', { name: 'ChatGPT subscription', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Continue with ChatGPT' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click()
  await expect(page.getByLabel('Saved connection count')).toHaveText('2')
  await expect(
    page.getByRole('button', { name: 'Continue with ChatGPT' }),
  ).toBeVisible()
  await expect(page.getByPlaceholder('e.g. OpenAI')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel settings' }).click()
  await expect(page.getByLabel('Saved connection count')).toHaveText('2')
  await expect(page.getByText('OpenAI', { exact: true }).first()).toBeVisible()
})

test('discovered display names are editable and use the full field width', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  await page.getByText('Personal API', { exact: true }).click()
  await page
    .getByRole('button', { name: 'Enable New discovered model' })
    .click()
  await page.getByText('New discovered model', { exact: true }).click()
  const field = page.getByPlaceholder('New discovered model')
  await expect(field).toHaveValue('New discovered model')
  await field.fill('My discovered model')
  await page.getByRole('button', { name: 'Refresh models' }).click()
  await expect(field).toHaveValue('My discovered model')
  const dimensions = await field.evaluate((input) => ({
    input: input.getBoundingClientRect().width,
    parent: input.parentElement!.getBoundingClientRect().width,
  }))
  expect(dimensions.parent - dimensions.input).toBeLessThan(2)
})
