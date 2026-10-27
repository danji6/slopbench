import { writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Records the test server and inherited Node workers for teardown assertions.
if (process.env.SLOPBENCH_TEST_PID_DIR) {
  writeFileSync(
    path.join(process.env.SLOPBENCH_TEST_PID_DIR, `${process.pid}.pid`),
    String(process.pid),
  )
}
