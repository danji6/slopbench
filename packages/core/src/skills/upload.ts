import { APP_ID } from '../const'

/** Binds temporary storage blobs to the owning upload without buffering the ZIP. */
export function skillUploadHeader(ticket: string) {
  return new TextEncoder().encode(
    `${APP_ID.toUpperCase()}-SKILL-UPLOAD\n${ticket}\n`,
  )
}
