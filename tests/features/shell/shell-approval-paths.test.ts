import {
  analyzeShellCommand,
  analyzeShellPathCandidates,
  commandReferencesForbiddenPath,
  extractPathCandidates,
  foldPaths,
  isPathAllowed,
  isPathForbidden,
  isShellCommandAutoApproved,
  isToolAutoApproved,
} from '@sb/convex/lib/tool/approval'
import { describe, expect, test } from 'bun:test'

describe('unsafe constructs', () => {
  test('command substitution is never auto-approved', () => {
    expect(isShellCommandAutoApproved('echo $(rm -rf /)', [])).toBe(false)
    expect(isShellCommandAutoApproved('echo `date`', [])).toBe(false)
    expect(isShellCommandAutoApproved('echo "$(date)"', [])).toBe(false)
    expect(isShellCommandAutoApproved('cat <(ls)', [])).toBe(false)
  })

  test('subshells are never auto-approved', () => {
    expect(isShellCommandAutoApproved('(cd /tmp && ls)', [])).toBe(false)
  })

  test('output redirection requires approval except /dev/null and fd dups', () => {
    expect(isShellCommandAutoApproved('ls > out.txt', [])).toBe(false)
    expect(isShellCommandAutoApproved('ls >> out.txt', [])).toBe(false)
    expect(isShellCommandAutoApproved('ls > /dev/null', [])).toBe(true)
    expect(isShellCommandAutoApproved('ls 2> /dev/null', [])).toBe(true)
    expect(isShellCommandAutoApproved('ls 2>&1', [])).toBe(true)
    expect(isShellCommandAutoApproved('ls &> out.txt', [])).toBe(false)
  })

  test('redirect-blocked commands still report rememberable patterns', () => {
    const analysis = analyzeShellCommand('git checkout x > log.txt', [])
    expect(analysis.unsafe).toBe(true)
    expect(analysis.unapproved).toEqual(['git checkout'])
  })

  test('substitution-blocked segments yield no rememberable pattern', () => {
    const analysis = analyzeShellCommand('echo $(whoami)', [])
    expect(analysis.unsafe).toBe(true)
    expect(analysis.unapproved).toEqual([])
  })

  test('empty commands are not auto-approved', () => {
    expect(isShellCommandAutoApproved('', [])).toBe(false)
    expect(isShellCommandAutoApproved('   ', [])).toBe(false)
  })
})

describe('wrappers and prefixes', () => {
  test('wrappers cannot hide the wrapped program', () => {
    expect(isShellCommandAutoApproved('sudo rm -rf /', ['sudo'])).toBe(false)
    expect(isShellCommandAutoApproved('xargs rm', ['xargs'])).toBe(false)
    expect(analyzeShellCommand('timeout 5 rm x', []).patterns).toEqual([
      'timeout rm',
    ])
    expect(analyzeShellCommand('sudo git push', []).patterns).toEqual([
      'sudo git push',
    ])
  })

  test('env assignments are skipped', () => {
    expect(isShellCommandAutoApproved('NODE_ENV=test ls', [])).toBe(true)
    expect(analyzeShellCommand('env FOO=1 git status', []).patterns).toEqual([
      'env git status',
    ])
  })

  test('quoted interpreter payloads approve the executable', () => {
    const { patterns } = analyzeShellCommand("sh -c 'rm -rf /'", [])
    expect(patterns).toEqual(['sh'])
    expect(isShellCommandAutoApproved("sh -c 'rm -rf /'", ['sh'])).toBe(true)
    expect(
      analyzeShellCommand('node -e "console.log(1)"', []).patterns,
    ).toEqual(['node'])
    expect(analyzeShellCommand("python -c 'print(1)'", []).patterns).toEqual([
      'python',
    ])
    expect(
      analyzeShellCommand("bash -O extglob -c 'echo first'", []).patterns,
    ).toEqual(['bash'])
    expect(
      analyzeShellCommand(
        'bun -e "import { value } from \'./module\'\nconsole.log(value)"',
        [],
      ).patterns,
    ).toEqual(['bun'])
    expect(isShellCommandAutoApproved('bun -e "console.log(1)"', ['bun'])).toBe(
      true,
    )
    expect(
      analyzeShellCommand('bun --eval="console.log(1)"', []).patterns,
    ).toEqual(['bun'])
  })

  test('unquoted scripts and non-interpreter subcommands stay precise', () => {
    expect(analyzeShellCommand('node script.js', []).patterns).toEqual([
      'node script.js',
    ])
    expect(analyzeShellCommand('python script.py', []).patterns).toEqual([
      'python script.py',
    ])
    expect(analyzeShellCommand('git "checkout" main', []).patterns).toEqual([
      'git checkout',
    ])
    expect(analyzeShellCommand('bun test "focused test"', []).patterns).toEqual(
      ['bun test'],
    )
    expect(analyzeShellCommand('bun run "build"', []).patterns).toEqual([
      'bun run',
    ])
  })
})

describe('extractPathCandidates', () => {
  test('treats Bun eval source as opaque data', () => {
    expect(
      analyzeShellPathCandidates(
        'bun -e "import { value } from \'./module\'\nconsole.log(value)"',
      ),
    ).toEqual({ candidates: [], complete: true })
  })

  test('collects path operands without executable names', () => {
    expect(extractPathCandidates('cat .env && ls dist')).toEqual([
      '.env',
      'dist',
    ])
  })

  test('includes --flag=value and env assignment values, skips bare flags', () => {
    expect(extractPathCandidates('grep -rn --file=.env.local foo')).toEqual([
      '.env.local',
      'foo',
    ])
    expect(extractPathCandidates('DOTENV_PATH=.env ls -la')).toEqual(['.env'])
  })

  test('keeps glob tokens for sidecar expansion', () => {
    expect(extractPathCandidates('cat .env*')).toEqual(['.env*'])
  })

  test('skips redirect leftovers and dedupes', () => {
    expect(extractPathCandidates('wc -l < notes.txt')).toEqual(['notes.txt'])
    expect(extractPathCandidates('ls a; ls a')).toEqual(['a'])
  })

  test('skips match-pattern flag arguments', () => {
    expect(
      extractPathCandidates("find src -name '*.ts' -not -path '*/dist/*'"),
    ).toEqual(['src'])
    expect(extractPathCandidates('grep --exclude-dir=.git foo src')).toEqual([
      'src',
    ])
  })

  test('classifies the reported sed and grep chain precisely', () => {
    const command =
      'cd /home/null/Projects/slopbench && ' +
      "sed -n '120,152p' packages/convex/src/actions/session/workspace.ts && " +
      'grep -n "postWorkspaceSidecar\\|requireAdminWorkspaceAction" -A 20 ' +
      'packages/convex/src/actions/session/workspace.ts | ' +
      "sed -n '/function postWorkspaceSidecar/,/^}/p;" +
      "/function requireAdminWorkspaceAction/,/^}/p'"

    expect(analyzeShellPathCandidates(command)).toEqual({
      candidates: [
        '/home/null/Projects/slopbench',
        'packages/convex/src/actions/session/workspace.ts',
      ],
      complete: true,
    })
  })

  test('distinguishes expressions, option values, and quoted paths', () => {
    expect(
      extractPathCandidates("sed -n -e '/error/p' 'logs/app output.log'"),
    ).toEqual(['logs/app output.log'])
    expect(
      extractPathCandidates("grep -e '/tmp/value' -A 20 'src/input file.ts'"),
    ).toEqual(['src/input file.ts'])
    expect(extractPathCandidates("grep --include '*.ts' needle src")).toEqual([
      'src',
    ])
    expect(
      extractPathCandidates("rg -g '*.ts' 'needle/value' packages tests"),
    ).toEqual(['packages', 'tests'])
    expect(extractPathCandidates('cat "/tmp/private file"')).toEqual([
      '/tmp/private file',
    ])
  })

  test('fails closed for ambiguous path semantics', () => {
    expect(analyzeShellPathCandidates('custom-tool "some data"')).toEqual({
      candidates: ['some data'],
      complete: false,
    })
    expect(analyzeShellPathCandidates("sed 'w /tmp/output' input.txt")).toEqual(
      {
        candidates: ['input.txt'],
        complete: false,
      },
    )
  })
})

describe('isToolAutoApproved', () => {
  test('shell uses the analyzer even without session approvals', () => {
    expect(isToolAutoApproved('shell', { command: 'ls' }, undefined)).toBe(true)
    expect(isToolAutoApproved('shell', { command: 'rm x' }, undefined)).toBe(
      false,
    )
    expect(
      isToolAutoApproved('shell', { command: 'rm x' }, { shell: ['rm'] }),
    ).toBe(true)
  })

  test('other tools match by name', () => {
    expect(isToolAutoApproved('edit_file', undefined, undefined)).toBe(false)
    expect(
      isToolAutoApproved('edit_file', undefined, { tools: ['edit_file'] }),
    ).toBe(true)
    // write_file and edit_file share one approval grant
    expect(
      isToolAutoApproved('write_file', undefined, { tools: ['edit_file'] }),
    ).toBe(true)
  })
})

describe('isPathAllowed', () => {
  test('matches exact grants', () => {
    expect(isPathAllowed('build', ['build'])).toBe(true)
    expect(isPathAllowed('dist', ['build'])).toBe(false)
    expect(isPathAllowed('build', [])).toBe(false)
  })

  test('a directory grant covers nested paths', () => {
    expect(isPathAllowed('build/binaries', ['build'])).toBe(true)
    expect(isPathAllowed('build/binaries/app', ['build'])).toBe(true)
    expect(isPathAllowed('/tmp/cache/x', ['/tmp/cache'])).toBe(true)
    expect(isPathAllowed('$HOME/.ssh/id_rsa', ['$HOME/.ssh'])).toBe(true)
  })

  test('a nested grant does not cover its parent or siblings', () => {
    expect(isPathAllowed('build', ['build/binaries'])).toBe(false)
    expect(isPathAllowed('build/logs', ['build/binaries'])).toBe(false)
  })

  test('prefixes only match at path boundaries', () => {
    expect(isPathAllowed('build-cache', ['build'])).toBe(false)
    expect(isPathAllowed('/tmp/cached', ['/tmp/cache'])).toBe(false)
  })
})

describe('foldCoveredPaths', () => {
  test('drops paths a broader entry already covers', () => {
    expect(foldPaths(['/home/x/.repos', '/home/x/.repos/project'])).toEqual([
      '/home/x/.repos',
    ])
    expect(foldPaths(['/home/x/.repos/project', '/home/x/.repos'])).toEqual([
      '/home/x/.repos',
    ])
  })

  test('keeps siblings and boundary near-misses', () => {
    expect(foldPaths(['build', 'build-cache', 'dist'])).toEqual([
      'build',
      'build-cache',
      'dist',
    ])
  })

  test('collapses duplicates', () => {
    expect(foldPaths(['/tmp/a.c', '/tmp/a.c'])).toEqual(['/tmp/a.c'])
  })

  test('keeps the outermost entry of a deep chain', () => {
    expect(foldPaths(['/a/b/c', '/a', '/a/b'])).toEqual(['/a'])
  })
})

describe('forbidden .git access', () => {
  test('flags any path with a .git segment', () => {
    expect(isPathForbidden('.git')).toBe(true)
    expect(isPathForbidden('.git/config')).toBe(true)
    expect(isPathForbidden('repo/.git/HEAD')).toBe(true)
    expect(isPathForbidden('./.git')).toBe(true)
    expect(isPathForbidden('repo\\.git\\HEAD')).toBe(true)
  })

  test('leaves lookalikes untouched', () => {
    expect(isPathForbidden('.gitignore')).toBe(false)
    expect(isPathForbidden('.github/workflows/ci.yml')).toBe(false)
    expect(isPathForbidden('src/git/client.ts')).toBe(false)
    expect(isPathForbidden('digit.txt')).toBe(false)
  })

  test('detects forbidden paths anywhere in a command', () => {
    expect(commandReferencesForbiddenPath('cat .git/config')).toBe(true)
    expect(commandReferencesForbiddenPath('rm -rf .git')).toBe(true)
    expect(commandReferencesForbiddenPath('ls && cat repo/.git/HEAD')).toBe(
      true,
    )
    expect(commandReferencesForbiddenPath('grep --file=.git/config x')).toBe(
      true,
    )
  })

  test('does not flag commands that only touch lookalikes', () => {
    expect(commandReferencesForbiddenPath('cat .gitignore')).toBe(false)
    expect(commandReferencesForbiddenPath('ls .github')).toBe(false)
    expect(commandReferencesForbiddenPath('git status')).toBe(false)
  })

  test('exclusion and match patterns are not path references', () => {
    expect(
      commandReferencesForbiddenPath(
        "find . -maxdepth 2 -type d -not -path '*/node_modules/*' -not -path '*/.git/*'",
      ),
    ).toBe(false)
    expect(
      commandReferencesForbiddenPath('grep -rn --exclude-dir=.git foo .'),
    ).toBe(false)
    expect(commandReferencesForbiddenPath("rg -g '!.git/' pattern")).toBe(false)
    expect(commandReferencesForbiddenPath("grep -e '.git/' src/x.ts")).toBe(
      false,
    )
  })

  test('does not treat sed or grep expressions as forbidden paths', () => {
    expect(commandReferencesForbiddenPath("sed -n '/.git/p' app.log")).toBe(
      false,
    )
    expect(commandReferencesForbiddenPath("grep '/.git/' src/app.ts")).toBe(
      false,
    )
    expect(commandReferencesForbiddenPath("sed -n '1p' .git/config")).toBe(true)
  })

  test('positional and non-pattern flag references still count', () => {
    expect(commandReferencesForbiddenPath('find .git -type f')).toBe(true)
    expect(commandReferencesForbiddenPath('grep --file=.git/config x')).toBe(
      true,
    )
    expect(commandReferencesForbiddenPath('cat .git/config')).toBe(true)
  })
})
