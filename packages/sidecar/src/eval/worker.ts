import {
  type EvaluationReply,
  type EvaluationRequest,
  evaluateRequest,
} from '@sb/core/interpreter/request'
import { parentPort, workerData } from 'node:worker_threads'

import { createFileExistsHelper, createFileHelper } from './file-helper'

const request = workerData as EvaluationRequest & {
  authorizedAgentDir?: string
  authorizedWorkDir?: string
  authorizedWorkDirs?: string[]
}
try {
  const result = await evaluateRequest(request, {
    readFile: createFileHelper(
      request.authorizedWorkDir,
      request.authorizedWorkDirs,
      request.authorizedAgentDir,
    ),
    fileExists: createFileExistsHelper(
      request.authorizedWorkDir,
      request.authorizedWorkDirs,
      request.authorizedAgentDir,
    ),
  })
  parentPort?.postMessage({ ok: true, result } satisfies EvaluationReply)
} catch {
  parentPort?.postMessage({
    ok: false,
    error: 'Dynamic JavaScript failed or exceeded its resource limit',
  } satisfies EvaluationReply)
}
