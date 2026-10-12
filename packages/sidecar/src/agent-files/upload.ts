import { skillUploadHeader } from '@sb/core/skills/upload'
import { Transform } from 'node:stream'

/** Verifies only the small ownership prefix, then cancels the download. */
export async function verifySkillUpload(fileUrl: string, ticket: string) {
  const expected = skillUploadHeader(ticket)
  const response = await fetch(fileUrl, { redirect: 'error' })
  if (!response.ok || !response.body)
    throw new Error('Skill upload is unavailable')

  const reader = response.body.getReader()
  let offset = 0
  try {
    while (offset < expected.length) {
      const { value, done } = await reader.read()
      if (done) return false
      for (
        let i = 0;
        i < value.length && offset < expected.length;
        i++, offset++
      ) {
        if (value[i] !== expected[offset]) return false
      }
    }
    return true
  } finally {
    await reader.cancel()
  }
}

/** Removes the ownership envelope incrementally before ZIP extraction. */
export function stripUploadHeader(ticket: string) {
  const expected = skillUploadHeader(ticket)
  let offset = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      let consumed = 0
      while (consumed < chunk.length && offset < expected.length) {
        if (chunk[consumed++] !== expected[offset++]) {
          done(new Error('Invalid skill upload ownership prefix'))
          return
        }
      }
      done(null, chunk.subarray(consumed))
    },
    flush(done) {
      done(
        offset === expected.length
          ? null
          : new Error('Incomplete skill upload'),
      )
    },
  })
}
