import { readFileSync, readdirSync, readlinkSync } from 'node:fs'

/** read(2) syscall numbers on x86_64 and aarch64. */
const READ_SYSCALL_NUMBERS = new Set(['0', '63'])
// Guards against pid cycles and pointer-vs-fd ambiguity in /proc/*/syscall
const MAX_TREE_PIDS = 64
const MAX_FD = 65_536

/**
 * True when any process in the job's tree is blocked in read(2) on a pty.
 * Linux only. Returns false elsewhere or whenever /proc is unreadable.
 */
export function probeStdinWait(rootPid: number): boolean {
  if (process.platform !== 'linux') return false
  return descendantPids(rootPid).some(isBlockedReadingPty)
}

function descendantPids(rootPid: number): number[] {
  const pids = [rootPid]
  for (let i = 0; i < pids.length && pids.length <= MAX_TREE_PIDS; i++) {
    pids.push(...childPids(pids[i]))
  }
  return pids
}

function childPids(pid: number): number[] {
  const children: number[] = []
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      const listed = readFileSync(`/proc/${pid}/task/${tid}/children`, 'ascii')
      for (const child of listed.trim().split(/\s+/)) {
        if (child) children.push(Number(child))
      }
    }
  } catch {
    // Process exited mid-walk
  }
  return children
}

function isBlockedReadingPty(pid: number): boolean {
  try {
    return readdirSync(`/proc/${pid}/task`).some((tid) =>
      threadBlockedReadingPty(pid, tid),
    )
  } catch {
    return false
  }
}

function threadBlockedReadingPty(pid: number, tid: string): boolean {
  try {
    const syscall = readFileSync(`/proc/${pid}/task/${tid}/syscall`, 'ascii')
    const [nr, fdHex] = syscall.trim().split(' ')
    if (!nr || !READ_SYSCALL_NUMBERS.has(nr)) return false
    const fd = Number.parseInt(fdHex, 16)
    if (!Number.isInteger(fd) || fd < 0 || fd > MAX_FD) return false
    return readlinkSync(`/proc/${pid}/fd/${fd}`).startsWith('/dev/pts/')
  } catch {
    return false
  }
}

// Alternate-screen toggles mark full-screen interactive programs that wait in
// poll/select rather than a blocking read
// eslint-disable-next-line no-control-regex
const ALT_SCREEN_TOGGLE = /\u001b\[\?(?:1049|1047|47)[hl]/g
// Longest toggle minus its final byte, so a sequence split across chunks still
// matches on the next scan
const ALT_CARRY_CHARS = 8

/**
 * Scans terminal output for alternate-screen enter/leave sequences.
 * Feed `carry + chunk` and store the returned carry for the next chunk.
 */
export function scanAltScreen(
  text: string,
  active: boolean,
): { active: boolean; carry: string } {
  const last = text.match(ALT_SCREEN_TOGGLE)?.at(-1)
  return {
    active: last ? last.endsWith('h') : active,
    carry: text.slice(-ALT_CARRY_CHARS),
  }
}
