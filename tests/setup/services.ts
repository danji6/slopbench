import { initializeEvaluator } from '@sb/core/interpreter/sandbox'

// Tests use local fixture servers, never a deployment credential.
process.env.SIDECAR_SECRET = 'slopbench-test-sidecar-credential'

await initializeEvaluator()
