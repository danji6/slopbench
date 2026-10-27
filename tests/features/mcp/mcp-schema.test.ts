import { mcpInputValidator } from '@sb/core/mcp-schema-validation'
import { parseMcpInputSchema } from '@sb/core/types/mcp-catalog'
import { expect, test } from 'bun:test'

test('modern schema constraints and formats are validated instead of ignored', () => {
  const validate = mcpInputValidator(
    JSON.stringify({
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
      patternProperties: { '^tag_': { type: 'string' } },
      unevaluatedProperties: false,
    }),
  )
  expect(validate({ email: 'person@example.com', tag_one: 'ok' }).valid).toBe(
    true,
  )
  expect(validate({ email: 'bad' }).valid).toBe(false)
  expect(validate({ unknown: 'must not pass' }).valid).toBe(false)
})

test('unsupported constraints, unresolved references and malformed schemas fail explicitly', () => {
  for (const schema of [
    { type: 'object', unsupportedConstraint: true },
    { type: 'object', $ref: 'https://example.com/external-schema' },
    { type: 'object', required: 'not-an-array' },
    { type: 'object', $schema: 'https://example.com/custom-dialect' },
  ])
    expect(() => mcpInputValidator(JSON.stringify(schema))).toThrow()
  expect(() => parseMcpInputSchema(undefined)).toThrow('missing')
  expect(() => parseMcpInputSchema('{')).toThrow()
})

test('repeated schema ids cannot borrow validators from another tool; draft-07 stays supported', () => {
  const first = mcpInputValidator(
    JSON.stringify({
      $id: 'https://example.com/shared',
      type: 'object',
      properties: { value: { type: 'string' } },
    }),
  )
  const second = mcpInputValidator(
    JSON.stringify({
      $id: 'https://example.com/shared',
      type: 'object',
      properties: { value: { type: 'number' } },
    }),
  )
  expect(first({ value: 'text' }).valid).toBe(true)
  expect(second({ value: 'text' }).valid).toBe(false)
  const legacy = mcpInputValidator(
    JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        pair: {
          type: 'array',
          items: [{ type: 'number' }, { type: 'string' }],
        },
      },
    }),
  )
  expect(legacy({ pair: [1, 'two'] }).valid).toBe(true)
  expect(legacy({ pair: ['wrong', 2] }).valid).toBe(false)
})
