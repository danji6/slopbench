import { APP_NAME } from '@sb/core/const'

const BASE_TITLE = APP_NAME
const FAVICON_ID = 'app-favicon'

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
  document.title = notificationDocumentTitle(count)
  const link = faviconLink()
  if (count <= 0) {
    link.href = '/favicon.svg'
    return
  }

  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  drawChatIcon(ctx)
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

function drawChatIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#6750a4'
  ctx.beginPath()
  ctx.roundRect(2, 3, 27, 23, 7)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(9, 24)
  ctx.lineTo(6, 31)
  ctx.lineTo(16, 25)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(10, 14, 2, 0, Math.PI * 2)
  ctx.arc(16, 14, 2, 0, Math.PI * 2)
  ctx.arc(22, 14, 2, 0, Math.PI * 2)
  ctx.fill()
}
