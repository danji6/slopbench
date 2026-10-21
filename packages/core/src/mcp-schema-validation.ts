import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import Ajv2020 from 'ajv/dist/2020.js'

import { parseMcpInputSchema } from './types/mcp-catalog'

const options = {
  strictSchema: true,
  strictTypes: false,
  strictTuples: false,
  strictRequired: false,
  validateSchema: true,
  allErrors: true,
}
const draft7 = addFormats(new Ajv(options))
const draft2020 = addFormats(new Ajv2020(options))

/** Compiles self-contained MCP schemas without silently ignoring unsupported constraints. */
export function mcpInputValidator(raw: string) {
  const schema = parseMcpInputSchema(raw)
  const dialect = schema.$schema
  const legacy = typeof dialect === 'string' && /draft-07\//.test(dialect)
  const ajv = legacy ? draft7 : draft2020
  // Only standard meta-schemas survive between tools; repeated $ids never reuse another tool's validator.
  ajv.removeSchema()
  try {
    return new AjvJsonSchemaValidator(ajv).getValidator(schema)
  } finally {
    ajv.removeSchema()
  }
}
