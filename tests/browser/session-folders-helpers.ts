import { type Locator, type Page, expect } from '@playwright/test'
import { APP_ID } from '@sb/core/const'

export async function dragTo(
  page: Page,
  source: Locator,
  destination: Locator,
  bottom = false,
) {
  const from = (await source.boundingBox())!
  const to = (await destination.boundingBox())!
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 12, y, { steps: 3 })
  await page.mouse.move(
    to.x + to.width / 2,
    bottom ? to.y + to.height - 10 : to.y + to.height / 2,
    {
      steps: 12,
    },
  )
}

export async function drag(
  page: Page,
  source: Locator,
  destination: Locator,
  bottom = false,
) {
  await dragTo(page, source, destination, bottom)
  await page.mouse.up()
}

export async function folderState(page: Page) {
  return JSON.parse(
    (await page.getByTestId('folder-state').textContent())!,
  ) as {
    _id: string
    parentId?: string
    pinned?: boolean
  }[]
}

export const folder = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })

export async function pinFolder(page: Page, name: string) {
  await page.getByRole('button', { name: `Options for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
}

export async function loadedPages(page: Page): Promise<Record<string, number>> {
  return JSON.parse((await page.getByTestId('loaded-pages').textContent())!)
}

export async function openSessionFolders(page: Page) {
  await page.addInitScript((appId) => {
    localStorage.setItem(
      `${appId}-session-folder-collapse`,
      JSON.stringify({ ungrouped: true }),
    )
  }, APP_ID)
  await page.goto('/?fixture=session-folders')
  await expect(folder(page, 'Portfolio')).toBeVisible()
}
