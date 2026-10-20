import { expect, test } from '@playwright/test'
import { DEFAULT_TITLE_SYSTEM_PROMPT } from '@sb/core/title-generation'

for (const titleModel of [false, true]) {
  test(`model search matches display names and ignores opaque references (title=${titleModel})`, async ({
    page,
  }) => {
    await page.goto('/?fixture=provider-connections')
    await page.getByText('Personal API', { exact: true }).click()
    await page
      .getByRole('button', { name: 'Enable New discovered model' })
      .click()
    await page.getByRole('button', { name: 'Save global settings' }).click()

    const picker = titleModel
      ? page.getByRole('combobox', { name: 'Title model' })
      : page.getByRole('combobox', { name: 'Composer model' })
    await picker.click()
    const search = page.getByPlaceholder('Search…', { exact: true })
    const same = page.getByRole('option', { name: 'Same model', exact: true })
    const discovered = page.getByRole('option', {
      name: 'New discovered model',
      exact: true,
    })

    await search.fill('DISCOVERED')
    await expect(discovered).toBeVisible()
    await expect(same).toHaveCount(0)
    await search.fill('Same model')
    await expect(same).toBeVisible()
    await expect(discovered).toHaveCount(0)
    await search.fill('personal')
    await expect(
      page.getByText('No models found.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(0)

    await search.clear()
    await expect(same).toBeVisible()
    await expect(discovered).toBeVisible()
    await search.fill('DISCOVERED')
    await search.press('Enter')
    await expect(picker).toHaveText('New discovered model')
    await expect(search).toBeHidden()
    if (!titleModel) {
      await expect(page.getByLabel('Selected reference')).toHaveText(
        'sb-model:personal:new',
      )
    }
    await picker.click()
    await expect(search).toHaveValue('')
    await expect(same).toBeVisible()
    await expect(discovered).toBeVisible()
  })
}

test('unchanged title prompts keep the settings draft clean', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  await page.getByRole('button', { name: 'Cancel settings' }).click()
  const changePrompt = page.getByRole('button', { name: 'Change prompt' })
  const dialog = page.getByRole('dialog', { name: 'Title prompt', exact: true })
  const editor = dialog.getByRole('textbox')
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  const reset = dialog.getByRole('button', { name: 'Reset', exact: true })
  const dirty = page.getByLabel('Settings draft dirty')

  await expect(dirty).toHaveText('false')
  await changePrompt.click()
  await expect(reset).toBeDisabled()
  await save.click()
  await expect(dirty).toHaveText('false')

  await changePrompt.click()
  await editor.fill('Temporary change')
  await expect(reset).toBeEnabled()
  await reset.click()
  await page
    .getByRole('alertdialog', { name: 'Reset title prompt?' })
    .getByRole('button', { name: 'Reset', exact: true })
    .click()
  await expect(reset).toBeDisabled()
  await save.click()
  await expect(dirty).toHaveText('false')

  await changePrompt.click()
  await editor.click()
  await editor.press('ControlOrMeta+End')
  await editor.press('!')
  await expect(reset).toBeEnabled()
  await editor.press('ControlOrMeta+z')
  await expect(reset).toBeDisabled()
  await save.click()
  await expect(dirty).toHaveText('false')

  await changePrompt.click()
  await editor.fill('Staged prompt')
  await save.click()
  await expect(dirty).toHaveText('true')
  await changePrompt.click()
  await reset.click()
  await page
    .getByRole('alertdialog', { name: 'Reset title prompt?' })
    .getByRole('button', { name: 'Reset', exact: true })
    .click()
  await save.click()
  await expect(dirty).toHaveText('false')
})

test('saving an unchanged custom title prompt preserves its text and other settings edits', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  const changePrompt = page.getByRole('button', { name: 'Change prompt' })
  const dialog = page.getByRole('dialog', { name: 'Title prompt', exact: true })
  const editor = dialog.getByRole('textbox')
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  const dirty = page.getByLabel('Settings draft dirty')
  const prompt = 'Title rules:\n\n1. Summarize the topic\n   in three words'

  await changePrompt.click()
  await editor.fill(prompt)
  await save.click()
  await expect(dirty).toHaveText('true')
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Saved title prompt')).toHaveText(prompt)
  await page.getByRole('button', { name: 'Cancel settings' }).click()
  await expect(dirty).toHaveText('false')

  await changePrompt.click()
  await expect(dialog.getByRole('button', { name: 'Reset' })).toBeEnabled()
  await editor.click()
  await editor.press('ControlOrMeta+End')
  await editor.press('!')
  await editor.press('ControlOrMeta+z')
  await save.click()
  await expect(dirty).toHaveText('false')

  await page.getByRole('combobox', { name: 'Title model' }).click()
  await page.getByRole('option', { name: 'Same model', exact: true }).click()
  await expect(dirty).toHaveText('true')
  await changePrompt.click()
  await save.click()
  await expect(dirty).toHaveText('true')
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Saved title prompt')).toHaveText(prompt)
})

test('title prompts can be edited, cancelled, saved, and reset to the default', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  const changePrompt = page.getByRole('button', {
    name: 'Change prompt',
    exact: true,
  })
  const dialog = page.getByRole('dialog', {
    name: 'Title prompt',
    exact: true,
  })
  const editor = dialog.getByRole('textbox')
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const reset = dialog.getByRole('button', { name: 'Reset', exact: true })
  const resetConfirmation = page.getByRole('alertdialog', {
    name: 'Reset title prompt?',
    exact: true,
  })

  await changePrompt.click()
  await expect(editor).toContainText(
    'Your task is to generate a concise title for a chat conversation.',
  )
  await expect(dialog.getByRole('textbox')).toHaveCount(1)
  await editor.fill('Discard this prompt')
  await cancel.click()
  await changePrompt.click()
  await expect(editor).toContainText('Return only the title.')

  await editor.fill('Return a short title in Italian.')
  await save.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('Saved title prompt')).toHaveText('')
  await changePrompt.click()
  await expect(editor).toHaveText('Return a short title in Italian.')
  await cancel.click()
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Saved title prompt')).toHaveText(
    'Return a short title in Italian.',
  )
  await page.getByRole('button', { name: 'Cancel settings' }).click()

  await changePrompt.click()
  await expect(editor).toHaveText('Return a short title in Italian.')
  await page.setViewportSize({ width: 390, height: 844 })
  await reset.click()
  await expect(resetConfirmation).toBeVisible()
  await resetConfirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(editor).toHaveText('Return a short title in Italian.')
  await reset.click()
  await resetConfirmation
    .getByRole('button', { name: 'Reset', exact: true })
    .click()
  await expect(editor).toContainText('Return only the title.')
  const resetBox = await reset.boundingBox()
  const cancelBox = await cancel.boundingBox()
  const saveBox = await save.boundingBox()
  const footerBox = await dialog
    .locator('[data-slot="dialog-footer"]')
    .boundingBox()
  expect(resetBox!.x + resetBox!.width).toBeLessThan(cancelBox!.x)
  expect(cancelBox!.x).toBeLessThan(saveBox!.x)
  expect(
    Math.abs(saveBox!.x + saveBox!.width - footerBox!.x - footerBox!.width),
  ).toBeLessThan(1)
  await cancel.click()
  await changePrompt.click()
  await expect(editor).toHaveText('Return a short title in Italian.')
  await reset.click()
  await resetConfirmation
    .getByRole('button', { name: 'Reset', exact: true })
    .click()
  await save.click()
  await expect(page.getByLabel('Settings draft dirty')).toHaveText('true')
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Saved title prompt')).toHaveText(
    DEFAULT_TITLE_SYSTEM_PROMPT,
  )
})

test('title models support selection, deselection, and an explicit None option', async ({
  page,
}) => {
  await page.goto('/?fixture=provider-connections')
  const picker = page.getByRole('combobox', { name: 'Title model' })
  await expect(picker).toHaveText('None')
  await picker.click()
  await page.getByRole('option', { name: 'Same model', exact: true }).click()
  await expect(picker).toHaveText('Same model')
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Saved title model')).toHaveText(
    'sb-model:personal:same',
  )

  await picker.click()
  await page.getByRole('option', { name: 'Same model', exact: true }).click()
  await expect(picker).toHaveText('None')
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Saved title model')).toHaveText('None')
  await page.getByRole('button', { name: 'Cancel settings' }).click()
  await expect(picker).toHaveText('None')

  await picker.click()
  await page.getByRole('option', { name: 'Same model', exact: true }).click()
  await page.getByRole('button', { name: 'Save global settings' }).click()
  await expect(page.getByLabel('Saved title model')).toHaveText(
    'sb-model:personal:same',
  )
  await picker.click()
  await page.getByRole('option', { name: 'None', exact: true }).click()
  await expect(picker).toHaveText('None')
})

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
