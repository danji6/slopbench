import { extractErrorMessage } from '@/lib/errors'
import { errorMessage } from '@sb/core/utils/errors'
import { userErrorMessage } from '@sb/core/utils/user-error'
import { expect, test } from 'bun:test'
import { ConvexError } from 'convex/values'
import { z } from 'zod'

test('client feedback hides schema dumps and stored document contents', () => {
  const failure = new Error(
    'Uncaught Error: Failed to insert or update a document in table "mcpServers" because it does not match the schema: Object contains extra field `hasKey`. Object: {TOKEN: "private"}. Validator: v.object(' +
      'x'.repeat(20000) +
      ')',
  )
  expect(extractErrorMessage(failure)).toBe(
    'The application could not save these changes. Please report this problem to the developer.',
  )
  expect(extractErrorMessage(failure)).not.toContain('private')
  expect(
    extractErrorMessage(
      new Error('ArgumentValidationError: ' + 'x'.repeat(20000)),
    ),
  ).toContain('could not process this request')
})

test('client feedback stays bounded and preserves useful application messages', () => {
  expect(
    extractErrorMessage(
      new ConvexError({ message: 'Toolkit directory is missing', code: 404 }),
    ),
  ).toBe('Toolkit directory is missing')
  const text = 'The toolkit returned a very long error. '.repeat(1000)
  expect(extractErrorMessage(new Error(text)).length).toBeLessThanOrEqual(320)
  expect(extractErrorMessage(new Error(text))).toEndWith('…')
  expect(errorMessage(new Error(text))).toBe(text.trim())
  expect(extractErrorMessage(null, 'Could not import this toolkit')).toBe(
    'Could not import this toolkit',
  )
  expect(extractErrorMessage(null)).toBe(
    'Something went wrong. Please try again.',
  )
  expect(userErrorMessage(null, 'x'.repeat(20000)).length).toBeLessThanOrEqual(
    320,
  )
})

test('validation feedback shows the first relevant field instead of a JSON dump', () => {
  const result = z.object({ command: z.string() }).safeParse({ command: 7 })
  expect(result.success).toBe(false)
  if (result.success) return
  expect(extractErrorMessage(result.error)).toBe(
    'command: Invalid input: expected string, received number',
  )
  expect(extractErrorMessage(new Error(result.error.message))).toBe(
    'command: Invalid input: expected string, received number',
  )
  expect(
    extractErrorMessage(new SyntaxError('Unexpected token at position 123')),
  ).toContain('Check that its format and syntax are correct')
})
