import { expect, test } from '@playwright/test'
import { buffer } from 'node:stream/consumers'

const cors = { 'Access-Control-Allow-Origin': '*' }

test('downloads original files from attachment buttons and Markdown links', async ({
  page,
  context,
}) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOh0AAAAASUVORK5CYII=',
    'base64',
  )
  const notes = '{"title":"Shared notes"}\n'

  await page.route('https://storage.example.test/image-original', (route) =>
    route.fulfill({ headers: cors, contentType: 'image/png', body: png }),
  )
  await page.route('**/attachments/notes/caf%C3%A9.json?resolve=1', (route) =>
    route.fulfill({
      headers: cors,
      json: { url: 'https://storage.example.test/notes-original' },
    }),
  )
  await page.route('https://storage.example.test/notes-original', (route) =>
    route.fulfill({
      headers: cors,
      contentType: 'application/json',
      body: notes,
    }),
  )
  const pdf = Buffer.from('%PDF-1.7 card')
  await page.route('https://storage.example.test/published-pdf', (route) =>
    route.fulfill({ headers: cors, contentType: 'application/pdf', body: pdf }),
  )
  await page.goto('/?fixture=attachment-download')
  const url = page.url()

  const cases = [
    {
      control: page.getByRole('button', { name: 'Download processed.pdf' }),
      filename: 'processed.pdf',
      bytes: pdf,
    },
    {
      control: page.getByRole('button', { name: 'Download image.png' }),
      filename: 'image.png',
      bytes: png,
    },
    {
      control: page.getByRole('link', { name: 'Shared notes' }),
      filename: 'café.json',
      bytes: Buffer.from(notes),
    },
  ]
  for (const { control, filename, bytes } of cases) {
    const event = page.waitForEvent('download')
    await control.click()
    const download = await event

    expect(download.suggestedFilename()).toBe(filename)
    expect(await buffer(await download.createReadStream())).toEqual(bytes)
    expect(page.url()).toBe(url)
    expect(context.pages()).toHaveLength(1)
  }
})
