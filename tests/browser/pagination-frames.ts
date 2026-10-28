import type { Page } from '@playwright/test'

type PaginationFrame = { top: number | null; visibleRows: number }
type Recording = { active: boolean; frames: PaginationFrame[] }

/** Samples the actual transcript between animation frames until explicitly stopped. */
export async function recordPaginationFrames(page: Page, selector?: string) {
  await page.evaluate((selector) => {
    const recording: Recording = { active: true, frames: [] }
    Reflect.set(window, 'paginationRecording', recording)
    const record = () => {
      if (!recording.active) return
      const row = selector ? document.querySelector(selector) : null
      const visibleRows = [
        ...document.querySelectorAll('[data-row-key]'),
      ].filter((item) => {
        const rect = item.getBoundingClientRect()
        return (
          rect.height > 0 && rect.bottom > 64 && rect.top < window.innerHeight
        )
      }).length
      recording.frames.push({
        top: row?.getBoundingClientRect().top ?? null,
        visibleRows,
      })
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  }, selector)
  return () =>
    page.evaluate(() => {
      const recording = Reflect.get(window, 'paginationRecording') as Recording
      recording.active = false
      Reflect.deleteProperty(window, 'paginationRecording')
      return recording.frames
    })
}
