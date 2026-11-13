import { initializeEvaluator } from '@cv/core/interpreter/sandbox'

// Tests use local fixture servers, never a deployment credential.
process.env.SIDECAR_SECRET = 'corvori-test-sidecar-credential'

await initializeEvaluator()
