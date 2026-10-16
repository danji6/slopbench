import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@sb/core/auth'

/** Validates a new password without changing its contents. */
export function validateNewPassword(password: string): true | string {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`
  }
  return true
}
