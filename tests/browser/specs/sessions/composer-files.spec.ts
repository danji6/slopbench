import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const picker = (page: Page) =>
  page.locator('input[type="file"][name="attachment"]')
const viewer = (page: Page) =>
  page.getByRole('dialog', { name: 'Media viewer' })
const dropOverlay = (page: Page) =>
  page.locator('[data-slot="composer-file-drop"]')
const clipUrl = new URL('../../fixtures/media/clip.webm', import.meta.url)

async function imageFile(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return {
    name: 'screen.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  }
}

function textTransfer(page: Page, filenames: string[]) {
  return page.evaluateHandle((names) => {
    const transfer = new DataTransfer()
    for (const name of names) {
      transfer.items.add(new File([name], name, { type: 'text/plain' }))
    }
    return transfer
  }, filenames)
}

const composer = (page: Page) => page.locator('[data-slot="chat-box"]')
const sendButton = (page: Page) =>
  composer(page).getByRole('button', { name: 'Send', exact: true })
const sendingButton = (page: Page) =>
  composer(page).getByRole('button', { name: 'Sending message' })

async function openSendFixture(page: Page) {
  await page.goto(
    'http://localhost:4178/?fixture=subagent-approvals&id=parent&deferSend',
  )
  return composer(page).locator('[contenteditable="true"]')
}

function completeSend(page: Page, success: boolean) {
  return page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent('complete-send', { detail }))
  }, success)
}

test('clears on upload and keeps mixed attachments visible through confirmation', async ({
  page,
}) => {
  const upload = Promise.withResolvers<void>()
  await page.route('**/composer-upload', async (route) => {
    await upload.promise
    await route.fulfill({ json: { storageId: 'staged' } })
  })
  const editor = await openSendFixture(page)
  const image = await imageFile(page)
  await picker(page).setInputFiles([
    image,
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') },
  ])
  await expect(
    composer(page).getByRole('button', { name: 'Preview notes.txt' }),
  ).toBeVisible()
  const submitted = page.getByText('Send these files', { exact: true })
  try {
    await editor.fill('Send these files')
    await sendButton(page).click()
    await expect(sendingButton(page)).toBeDisabled()
    await expect(editor).toHaveText('')
    await expect(
      composer(page).locator('[data-slot="file-strip"]'),
    ).toHaveCount(0)
    await expect(submitted).toHaveCount(0)
  } finally {
    upload.resolve()
  }

  const files = page.locator('[data-slot="file-block"]')
  await expect(submitted).toHaveCount(1)
  await expect(files.getByRole('img', { name: 'screen.png' })).toBeVisible()
  await expect(
    files.getByRole('button', { name: 'Preview notes.txt' }),
  ).toBeVisible()

  await completeSend(page, true)
  await expect(
    page.locator('[data-message-id="sent-0"]').first(),
  ).toBeAttached()
  const preview = files.getByRole('img', { name: 'screen.png' })
  await expect(preview).toHaveAttribute('src', /^data:image/)
  await expect(
    files.getByRole('button', { name: 'Preview notes.txt' }),
  ).toBeVisible()
  await expect(sendingButton(page)).toHaveCount(0)
  await expect(submitted).toHaveCount(1)

  const remote = Promise.withResolvers<void>()
  await page.route('**/composer-file/*', async (route) => {
    await remote.promise
    await route.fulfill({ contentType: image.mimeType, body: image.buffer })
  })
  try {
    await page.evaluate(() =>
      window.dispatchEvent(new Event('release-attachment-urls')),
    )
    await expect(files.getByLabel('Download screen.png')).toBeVisible()
    await expect(preview).toHaveAttribute('src', /^data:image/)
  } finally {
    remote.resolve()
  }
  await expect(preview).toHaveAttribute('src', /^blob:/)
})

test('restores an attachment-only draft when its send fails', async ({
  page,
}) => {
  await page.route('**/composer-upload', (route) =>
    route.fulfill({ json: { storageId: 'staged' } }),
  )
  await openSendFixture(page)
  await picker(page).setInputFiles({
    name: 'restore.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('restore'),
  })
  await sendButton(page).click()
  const file = page.getByRole('button', { name: 'Preview restore.txt' })
  await expect(file).toBeVisible()
  await expect(
    composer(page).getByRole('button', { name: 'Preview restore.txt' }),
  ).toHaveCount(0)
  await completeSend(page, false)
  await expect(file).toHaveCount(1)
  await expect(
    composer(page).getByRole('button', { name: 'Preview restore.txt' }),
  ).toBeVisible()
  await expect(sendButton(page)).toBeEnabled()
})

test('retries a failed send without replacing newer composer text', async ({
  page,
}) => {
  const editor = await openSendFixture(page)
  await editor.fill('Original message')
  await sendButton(page).click()
  const original = page.getByText('Original message', { exact: true })
  await expect(original).toHaveCount(1)
  await expect(editor).toHaveText('')
  await editor.fill('New draft')
  await editor.press('Enter')
  await expect(sendingButton(page)).toBeDisabled()
  await completeSend(page, false)

  await expect(original).toHaveCount(0)
  await expect(editor).toHaveText('New draft')
  const retry = composer(page).getByRole('button', {
    name: 'Retry',
    exact: true,
  })
  await retry.click()
  await expect(original).toHaveCount(1)
  await completeSend(page, true)
  await expect(retry).toHaveCount(0)
  await expect(original).toHaveCount(1)
  await expect(editor).toHaveText('New draft')
})

test('navigates a mixed gallery in strip order and stops at both ends', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat')
  const image = await imageFile(page)
  const buffer = await readFile(clipUrl)
  await picker(page).setInputFiles([
    image,
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') },
    { name: 'clip.webm', mimeType: 'video/webm', buffer },
    {
      name: 'broken.webm',
      mimeType: 'video/webm',
      buffer: Buffer.from('bad video'),
    },
    image,
  ])
  const editor = page.locator('[contenteditable="true"]')
  await editor.fill('/')
  await expect(page.locator('[data-slot="command-picker"]')).toBeVisible()

  const videoThumb = page.getByRole('button', { name: 'Open clip.webm' })
  await expect(videoThumb.getByRole('img')).toBeVisible()
  await videoThumb.click()
  const dialog = viewer(page)
  const video = dialog.locator('video')
  const previous = dialog.getByRole('button', { name: 'Previous media' })
  const next = dialog.getByRole('button', { name: 'Next media' })
  await expect(video).toHaveJSProperty('controls', true)
  await expect(video).toHaveJSProperty('muted', true)
  await expect(video).toHaveCSS('opacity', '1')
  await expect(video).toHaveCSS('width', '640px')
  await expect(video).toHaveCSS('height', '360px')
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0)
  await expect(video).toHaveJSProperty('paused', false)
  const playingVideo = await video.elementHandle()

  await page.keyboard.press('ArrowLeft')
  await expect(previous).toBeDisabled()
  expect(
    await playingVideo.evaluate((element: HTMLVideoElement) => element.paused),
  ).toBe(true)
  await expect(dialog.getByRole('img', { name: 'screen.png' })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(previous).toBeDisabled()
  await next.click()
  await expect(video).toHaveJSProperty('paused', false)
  await page.setViewportSize({ width: 800, height: 300 })
  await expect(video).toHaveCSS('width', '480px')
  await expect(video).toHaveCSS('height', '270px')
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('status')).toHaveText(
    'Could not load broken.webm',
  )
  await page.keyboard.press('ArrowRight')
  await expect(next).toBeDisabled()
  await expect(dialog.getByRole('img', { name: 'screen.png' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(next).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(videoThumb).toBeFocused()
  await expect(editor).toHaveText('/')
})

test('uses a blurred video placeholder until the first frame loads', async ({
  page,
}) => {
  const buffer = await readFile(clipUrl)
  const { promise: waiting, resolve: releaseVideo } =
    Promise.withResolvers<void>()
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (this.closest('[data-slot="media-viewer"]'))
        this.src = '/delayed-clip.webm'
      return play.call(this)
    }
  })
  await page.route('**/delayed-clip.webm', async (route) => {
    await waiting
    await route.fulfill({ contentType: 'video/webm', body: buffer })
  })
  await page.goto('/?fixture=empty-chat')
  await picker(page).setInputFiles({
    name: 'clip.webm',
    mimeType: 'video/webm',
    buffer,
  })
  const thumbnail = page.getByRole('button', { name: 'Open clip.webm' })
  await expect(thumbnail.getByRole('img')).toBeVisible()
  await thumbnail.click()

  const preview = viewer(page).locator('[data-slot="lightbox-video-preview"]')
  const loading = viewer(page).getByRole('progressbar', { name: 'Loading' })
  const video = viewer(page).locator('video')
  try {
    await expect(video).toHaveAttribute('src', '/delayed-clip.webm')
    await expect(loading).toBeVisible()
    await expect(preview).toHaveCSS('filter', /blur\(/)
    await expect(preview).toHaveCSS('opacity', '1')
  } finally {
    releaseVideo()
  }
  await expect(loading).toBeHidden()
  await expect(preview).toHaveCSS('opacity', '0')
  await expect(video).toHaveCSS('filter', 'none')
})

test('opens a single-item viewer over the expanded composer', async ({
  page,
}) => {
  await page.goto('/?fixture=empty-chat')
  await picker(page).setInputFiles(await imageFile(page))
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  const expanded = page.getByRole('dialog', { name: 'Expanded editor' })
  await expect(expanded).toBeVisible()
  const target = expanded.locator('[data-slot="fullscreen-overlay"]')
  const dataTransfer = await textTransfer(page, ['inside.txt'])
  await target.dispatchEvent('dragenter', { dataTransfer })
  await expect(expanded.locator(dropOverlay(page))).toBeVisible()
  await target.dispatchEvent('drop', { dataTransfer })
  await expect(
    expanded.getByRole('button', { name: 'Preview inside.txt' }),
  ).toBeVisible()

  const thumbnail = expanded.getByRole('button', { name: 'Open screen.png' })
  await thumbnail.click()
  const dialog = viewer(page)
  await expect(
    dialog.getByRole('button', { name: 'Close', exact: true }),
  ).toBeFocused()
  await expect(
    dialog.getByRole('button', { name: /^(Previous|Next) media$/ }),
  ).toHaveCount(0)

  const blocked = await textTransfer(page, ['blocked.txt'])
  await dialog.dispatchEvent('dragenter', { dataTransfer: blocked })
  await expect(dropOverlay(page)).toBeHidden()
  await dialog.dispatchEvent('drop', { dataTransfer: blocked })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(expanded).toBeVisible()
  await expect(thumbnail).toBeFocused()
  await expect(
    expanded.getByRole('button', { name: 'Preview blocked.txt' }),
  ).toHaveCount(0)
})

test('appends file drops from the chat and desktop sidebar and ignores link drags', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/?fixture=empty-chat&withNavigation')
  const heading = page.getByRole('heading', { name: 'What’s on your mind?' })
  const composer = page.getByRole('region', { name: 'File upload drop zone' })
  const dataTransfer = await textTransfer(page, ['one.txt', 'two.txt'])
  await heading.dispatchEvent('dragenter', { dataTransfer })
  const overlay = composer.locator(dropOverlay(page))
  await expect(overlay).toBeInViewport()
  await expect(overlay).toHaveCSS('position', 'absolute')
  await heading.dispatchEvent('dragleave', { dataTransfer })
  await expect(dropOverlay(page)).toBeHidden()

  const editor = composer.locator('[contenteditable="true"]')
  const coords = await editor.evaluate((element) => {
    const { left, top } = element.getBoundingClientRect()
    return { clientX: left + 8, clientY: top + 2 }
  })
  const dropCursor = page.locator(
    '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline',
  )
  await editor.dispatchEvent('dragover', { ...coords, dataTransfer })
  await expect(overlay).toBeVisible()
  await expect(dropCursor).toHaveCount(0)
  await editor.dispatchEvent('dragleave', { dataTransfer })
  await expect(overlay).toBeHidden()

  const text = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'dragged text')
    return transfer
  })
  await editor.dispatchEvent('dragover', { ...coords, dataTransfer: text })
  await expect(dropCursor).toBeVisible()
  await expect(overlay).toBeHidden()
  await editor.dispatchEvent('dragleave', { dataTransfer: text })

  await heading.dispatchEvent('dragenter', { dataTransfer })
  await heading.dispatchEvent('drop', { dataTransfer })

  const files = page.getByText(/^(one|two|three)\.txt$/)
  await expect(files).toHaveText(['one.txt', 'two.txt'])
  const sidebar = page.locator('[data-slot="sidebar-panel"][data-side="left"]')
  const last = await textTransfer(page, ['three.txt'])
  await sidebar.dispatchEvent('dragenter', { dataTransfer: last })
  await expect(dropOverlay(page)).toBeVisible()
  await sidebar.dispatchEvent('drop', { dataTransfer: last })
  await expect(files).toHaveText(['one.txt', 'two.txt', 'three.txt'])
  await expect(dropOverlay(page)).toBeHidden()

  const handled = await heading.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.setData('text/uri-list', 'https://example.test/')
    return ['dragenter', 'dragover', 'drop'].some((type) => {
      const event = new DragEvent(type, {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      })
      return !element.dispatchEvent(event)
    })
  })
  expect(handled).toBe(false)
  await expect(dropOverlay(page)).toBeHidden()
  await expect(files).toHaveCount(3)
})

test('keeps attachment-only drafts and blocks drops only during review', async ({
  page,
}) => {
  await page.goto(
    '/?fixture=subagent-approvals&id=parent&history&delayedApprovals',
  )
  const composer = page.locator('[data-slot="chat-box"]')
  await expect(composer).toBeInViewport()
  await page.mouse.move(500, 300)
  await page.mouse.wheel(0, -4000)
  await expect(composer).toHaveAttribute('inert', '')
  const target = page.locator('[data-slot="chat-layout"]')
  const dataTransfer = await textTransfer(page, ['offscreen.txt'])
  await target.dispatchEvent('dragenter', { dataTransfer })
  await expect(dropOverlay(page)).toBeVisible()
  await expect(dropOverlay(page)).not.toBeInViewport()
  await target.dispatchEvent('drop', { dataTransfer })
  await expect(
    composer.getByRole('button', { name: 'Preview offscreen.txt' }),
  ).toBeInViewport()

  await page.evaluate(() =>
    window.dispatchEvent(new Event('release-approvals')),
  )
  const review = page.getByRole('button', {
    name: 'Review approval',
    exact: true,
  })
  const picker = page.locator('[data-slot="tool-approval-picker"]')
  await expect(review).toBeVisible()
  await expect(picker).toHaveCount(0)

  const deferred = await textTransfer(page, ['deferred.txt'])
  await target.dispatchEvent('drop', { dataTransfer: deferred })
  await expect(
    composer.getByRole('button', { name: 'Preview deferred.txt' }),
  ).toBeInViewport()
  await review.click()
  await expect(picker).toBeVisible()
  const blocked = await textTransfer(page, ['blocked.txt'])
  await target.dispatchEvent('dragenter', { dataTransfer: blocked })
  await expect(dropOverlay(page)).toBeHidden()
  await target.dispatchEvent('drop', { dataTransfer: blocked })
  await expect(page.getByText('blocked.txt', { exact: true })).toHaveCount(0)

  await picker.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(
    composer.getByRole('button', { name: 'Preview offscreen.txt' }),
  ).toBeInViewport()
  await expect(
    composer.getByRole('button', { name: 'Preview deferred.txt' }),
  ).toBeInViewport()
})

test('keeps pending approval aligned with the toolbar with the dock hidden or visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(
    '/?fixture=subagent-approvals&id=parent&history&delayedApprovals&typing=5',
  )
  const composer = page.locator('[data-slot="chat-box"]')
  await expect(composer).toBeInViewport()
  await page.mouse.move(200, 300)
  await page.mouse.wheel(0, -4000)
  await expect(composer).toHaveAttribute('inert', '')

  await page.evaluate(() =>
    window.dispatchEvent(new Event('release-approvals')),
  )
  const review = page.getByRole('button', {
    name: 'Review approval',
    exact: true,
  })
  await expect(review).toBeInViewport()
  const toolbar = page.locator('[data-slot="chat-toolbar"]')
  async function expectToolbarAlignment() {
    await expect(toolbar).toBeInViewport()
    await expect(async () => {
      const reviewBounds = (await review.boundingBox())!
      const toolbarBounds = (await toolbar.boundingBox())!
      expect(reviewBounds.y).toBeCloseTo(toolbarBounds.y, 0)
      expect(reviewBounds.height).toBeCloseTo(toolbarBounds.height, 0)
      expect(reviewBounds.x + reviewBounds.width).toBeLessThan(toolbarBounds.x)
    }).toPass({ timeout: 3000 })
  }
  await expectToolbarAlignment()

  const activity = page.getByRole('status', {
    name: 'Alice, Bob, Carol, Dave, Eve are typing',
  })
  await expect(activity).toBeInViewport()
  const reviewBounds = (await review.boundingBox())!
  const activityBounds = (await activity.boundingBox())!
  expect(reviewBounds.y + reviewBounds.height).toBeLessThanOrEqual(
    activityBounds.y,
  )
  await review.click()
  const picker = page.locator('[data-slot="tool-approval-picker"]')
  await expect(picker).toBeInViewport()
  await picker.getByRole('button', { name: 'Hide', exact: true }).click()
  const editor = composer.locator('[contenteditable="true"]')
  await expect(editor).toBeFocused()

  await editor.fill('Keep the composer docked')
  await page.mouse.move(200, 300)
  await page.mouse.wheel(0, -4000)
  await expect(composer).toBeInViewport()
  const dockRow = page.locator('[data-slot="dock-widgets"]')
  await expect(
    dockRow.getByRole('button', { name: 'Review approval' }),
  ).toBeInViewport()
  await expect(
    dockRow.getByRole('button', { name: 'Scroll to bottom' }),
  ).toBeInViewport()
  await expectToolbarAlignment()
})
