export const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Programs that execute another command while retaining their own prefix. */
// prettier-ignore
export const WRAPPER_PROGRAMS = new Set([
  ...['sudo', 'doas', 'env', 'xargs', 'nohup', 'timeout', 'stdbuf'],
  ...['time', 'nice', 'ionice', 'command', 'builtin', 'exec', 'eval'],
  ...['sh', 'bash', 'zsh', 'fish', 'dash'],
])

/** Interpreters whose quoted payload is authorized with the executable. */
export const INTERPRETER_PROGRAMS = new Set([
  'node',
  'python',
  'python3',
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
])

/** Patterns that never need approval (they still respect path approval). */
// prettier-ignore
export const DEFAULT_SAFE_SHELL_PATTERNS: ReadonlySet<string> = new Set([
  // Shell basics
  ...['cd', 'echo', 'printf', 'true', 'false', 'sleep', 'seq', 'expr'],
  // Files & paths (read-only; find is argument-gated)
  ...['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'stat', 'file', 'du', 'df'],
  ...['tree', 'basename', 'dirname', 'realpath', 'readlink', 'find'],
  ...['which', 'whereis', 'type'],
  // Text processing (pure filters; sed is argument-gated)
  ...['grep', 'egrep', 'fgrep', 'rg', 'sort', 'uniq', 'cut', 'tr', 'column'],
  ...['sed'],
  ...['diff', 'cmp', 'comm', 'jq', 'yq', 'xxd', 'hexdump', 'strings'],
  // Checksums
  ...['md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'cksum', 'b2sum'],
  // System info
  ...['date', 'cal', 'uptime', 'whoami', 'id', 'groups', 'hostname'],
  ...['uname', 'arch', 'nproc', 'free', 'ps'],
  // git (read-only subcommands; remote is argument-gated)
  ...['git status', 'git log', 'git diff', 'git show', 'git blame'],
  ...['git shortlog', 'git describe', 'git rev-parse', 'git rev-list'],
  ...['git ls-files', 'git ls-tree', 'git cat-file', 'git grep'],
  ...['git show-ref', 'git count-objects', 'git remote'],
  // Package managers (read-only subcommands)
  ...['npm ls', 'npm list', 'npm view', 'npm info', 'npm outdated'],
  ...['npm ping', 'npm root', 'npm prefix'],
  ...['pnpm ls', 'pnpm list', 'pnpm outdated', 'pnpm why'],
  ...['yarn list', 'yarn info', 'yarn why'],
  ...['bun outdated', 'bun pm ls', 'bun pm why'],
  ...['uv tree', 'uv pip check', 'uv pip list'],
  ...['uv pip show', 'uv pip tree', 'uv python list', 'uv tool list'],
  ...['uv cache dir'],
  ...['pip list', 'pip show', 'pip check', 'pip freeze', 'pip inspect'],
  ...['pip debug', 'pip index', 'pip search'],
  ...['pip3 list', 'pip3 show', 'pip3 check', 'pip3 freeze', 'pip3 inspect'],
  ...['pip3 debug', 'pip3 index', 'pip3 search'],
  ...['pacman -Q', 'pacman -Qi', 'pacman -Ql', 'pacman -Qk'],
  ...['pacman -Qo', 'pacman -Qq', 'pacman -Qs', 'pacman -Qu'],
  ...['pacman -T', 'pacman -V'],
  ...['cargo check', 'cargo tree', 'cargo metadata', 'cargo search'],
  ...['go version', 'go env', 'go list', 'go vet'],
  ...['brew list', 'brew info', 'brew outdated', 'brew search', 'brew deps'],
  ...['apt list', 'apt search', 'apt-cache'],
  // Containers / infra (read-only subcommands)
  ...['docker ps', 'docker images', 'docker logs', 'docker inspect'],
  ...['docker version', 'docker info', 'podman ps', 'podman images'],
  ...['kubectl get', 'kubectl describe', 'kubectl logs', 'kubectl explain'],
  ...['kubectl version'],
  ...['systemctl status', 'systemctl list-units', 'systemctl is-active'],
  ...['systemctl show'],
])
