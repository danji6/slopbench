import { APP_NAME } from '@cv/core/const'

const BASE_TITLE = APP_NAME
const FAVICON_ID = 'app-favicon'
const FAVICON_URL = '/favicon.png'
let latestUnreadCount = 0

/** Formats the compact count drawn inside the favicon badge. */
export function notificationBadgeLabel(count: number): string {
  if (count <= 0) return ''
  return count > 9 ? '9+' : String(count)
}

/** Formats an accessible document title containing the exact unread count. */
export function notificationDocumentTitle(count: number): string {
  return count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE
}

/** Updates the document title and generated favicon for the unread count. */
export function updateNotificationFavicon(count: number) {
  latestUnreadCount = count
  document.title = notificationDocumentTitle(count)
  const link = faviconLink()
  if (count <= 0) {
    link.href = FAVICON_URL
    return
  }

  const image = new Image()
  image.onload = () => {
    if (count === latestUnreadCount) drawBadgedFavicon(link, image, count)
  }
  image.src = FAVICON_URL
}

function drawBadgedFavicon(
  link: HTMLLinkElement,
  image: HTMLImageElement,
  count: number,
) {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const scale = 32 / Math.max(image.naturalWidth, image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  ctx.drawImage(image, (32 - width) / 2, (32 - height) / 2, width, height)
  ctx.fillStyle = '#ba1a1a'
  ctx.beginPath()
  ctx.arc(23, 9, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${count > 9 ? 8 : 11}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(notificationBadgeLabel(count), 23, 9.5)
  link.href = canvas.toDataURL('image/png')
}

function faviconLink(): HTMLLinkElement {
  const existing = document.getElementById(FAVICON_ID)
  if (existing instanceof HTMLLinkElement) return existing

  const link = document.createElement('link')
  link.id = FAVICON_ID
  link.rel = 'icon'
  document.head.append(link)
  return link
}
