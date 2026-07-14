/// <reference types="bun-types" />
import {
  analyzeShellCommand,
  commandReferencesForbiddenPath,
  extractPathCandidates,
  isPathAllowed,
  isPathForbidden,
  isShellCommandAutoApproved,
  isToolAutoApproved,
} from '@sb/convex/lib/tool/approval'
import { describe, expect, test } from 'bun:test'

describe('default safe commands', () => {
  test('auto-approves common read-only commands with no allowlist', () => {
    for (const command of [
      'ls -la',
      'pwd',
      'git status',
      'git log --oneline -10',
      'git diff HEAD~1',
      'cat package.json',
      'grep -rn "foo" src',
      'docker ps -a',
      'npm ls --depth=0',
      'bun pm ls',
      'uv pip list',
      'pip show react',
      'pacman -Qi shell',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(true)
  })

  test('requires approval for mutating commands', () => {
    for (const command of [
      'rm -rf dist',
      'git checkout main',
      'git push origin master',
      'npm install lodash',
      'bun add lodash',
      'bun pm cache rm',
      'uv pip install ruff',
      'uv cache clean',
      'pip install ruff',
      'pacman -Syu',
      'pacman -R package',
      'mv a b',
      'chmod +x run.sh',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(false)
  })

  test('sub-commands are distinct patterns', () => {
    expect(isShellCommandAutoApproved('git status', [])).toBe(true)
    expect(isShellCommandAutoApproved('git stash', [])).toBe(false)
    expect(isShellCommandAutoApproved('git stash', ['git stash'])).toBe(true)
    // An allowed sub-command never covers a sibling.
    expect(isShellCommandAutoApproved('git push', ['git stash'])).toBe(false)
  })

  test('nested package-manager subcommands are distinct patterns', () => {
    expect(analyzeShellCommand('bun pm ls', []).patterns).toEqual(['bun pm ls'])
    expect(analyzeShellCommand('bun pm cache rm', []).patterns).toEqual([
      'bun pm cache',
    ])
    expect(analyzeShellCommand('uv pip list', []).patterns).toEqual([
      'uv pip list',
    ])
    expect(analyzeShellCommand('uv pip install ruff', []).patterns).toEqual([
      'uv pip install',
    ])
  })

  test('version/help-only invocations are safe for any program', () => {
    expect(isShellCommandAutoApproved('node --version', [])).toBe(true)
    expect(isShellCommandAutoApproved('rm --help', [])).toBe(true)
    expect(isShellCommandAutoApproved('rm --help file', [])).toBe(false)
  })
})

describe('argument-gated safe programs', () => {
  test('find is safe without mutating actions', () => {
    for (const command of [
      'find . -maxdepth 2 -type d',
      "find src -name '*.ts' -not -path '*/generated/*'",
      'find . -type f -newer ref.txt | head -20',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(true)
  })

  test('find with delete/exec/write actions requires approval', () => {
    for (const command of [
      "find . -name '*.tmp' -delete",
      'find . -type f -exec rm {} \\;',
      'find . -execdir chmod +x {} +',
      'find . -ok rm {} \\;',
      'find . -fprint out.txt',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(false)
  })

  test('sed is safe for stdout-only filters', () => {
    for (const command of [
      "sed -n '1,50p' file.txt",
      "sed 's/foo/bar/g' input.txt",
      "sed -n '/error/p' app.log",
      "sed -E 's|(a)|\\1|' f",
      "sed -e 's/a/b/' -e '/x/d' f",
      "cat f | sed 's/a/b/'",
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(true)
  })

  test('sed with in-place, script files, or exec/write commands requires approval', () => {
    for (const command of [
      "sed -i 's/a/b/' f.txt",
      "sed -i.bak 's/a/b/' f.txt",
      "sed -Ei 's/a/b/' f.txt",
      "sed --in-place 's/a/b/' f.txt",
      'sed -f script.sed f.txt',
      "sed 's/a/b/e' f.txt",
      "sed '1e date' f.txt",
      "sed 'w out.txt' f.txt",
      "sed '1r other.txt' f.txt",
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(false)
  })

  test('git remote is safe for read-only forms', () => {
    for (const command of [
      'git remote',
      'git remote -v',
      'git remote --verbose',
      'git remote show origin',
      'git remote get-url origin',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(true)
  })

  test('git remote mutations require approval', () => {
    for (const command of [
      'git remote add origin https://example.com/x.git',
      'git remote remove origin',
      'git remote rename a b',
      'git remote set-url origin https://example.com/y.git',
      'git remote prune origin',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(false)
  })

  test('global value flags do not hide the git subcommand', () => {
    // `-C dir` / `-c k=v` / `--git-dir dir` must not be mistaken for the
    // subcommand (the arg of the flag was being read as one).
    for (const command of [
      'git -C /workspace show --stat HEAD',
      'git -C /workspace log --oneline -5',
      'git -c core.pager=cat log',
      'git --git-dir /repo/.git status',
      'git -C /workspace remote -v',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(true)

    // …and the gate still sees remote mutations through the global flags.
    for (const command of [
      'git -C /workspace remote add origin https://example.com/x.git',
      'git -C /workspace remote prune origin',
    ])
      expect(isShellCommandAutoApproved(command, [])).toBe(false)

    expect(
      analyzeShellCommand('git -C /workspace show HEAD', []).patterns,
    ).toEqual(['git show'])
  })

  test('the session allowlist still covers gated invocations', () => {
    expect(isShellCommandAutoApproved('find . -delete', ['find'])).toBe(true)
    expect(isShellCommandAutoApproved("sed -i 's/a/b/' f", ['sed'])).toBe(true)
    expect(
      isShellCommandAutoApproved('git remote add origin x', ['git remote']),
    ).toBe(true)
  })

  test('gated programs report their plain pattern', () => {
    expect(analyzeShellCommand('find . -delete', []).unapproved).toEqual([
      'find',
    ])
  })
})

describe('command chains', () => {
  test('every segment must be covered', () => {
    expect(isShellCommandAutoApproved('git status && git log', [])).toBe(true)
    expect(isShellCommandAutoApproved('git status && git checkout x', [])).toBe(
      false,
    )
    expect(
      isShellCommandAutoApproved('git status && git checkout x', [
        'git checkout',
      ]),
    ).toBe(true)
  })

  test('matches segments in any order', () => {
    const allowlist = ['git checkout']
    expect(
      isShellCommandAutoApproved('git checkout x && git status', allowlist),
    ).toBe(true)
    expect(
      isShellCommandAutoApproved('git status && git checkout x', allowlist),
    ).toBe(true)
  })

  test('splits on ||, ;, | and newlines', () => {
    expect(isShellCommandAutoApproved('ls || pwd', [])).toBe(true)
    expect(isShellCommandAutoApproved('ls; rm x', [])).toBe(false)
    expect(isShellCommandAutoApproved('cat foo | grep bar | wc -l', [])).toBe(
      true,
    )
    expect(isShellCommandAutoApproved('ls\nrm x', [])).toBe(false)
  })

  test('reports only uncovered patterns as unapproved', () => {
    const { unapproved } = analyzeShellCommand(
      'git status && git checkout main && rm -rf dist',
      [],
    )
    expect(unapproved).toEqual(['git checkout', 'rm'])
  })

  test('operators inside quotes do not split segments', () => {
    expect(isShellCommandAutoApproved('echo "a && b; c | d"', [])).toBe(true)
    expect(isShellCommandAutoApproved("echo 'rm -rf /'", [])).toBe(true)
  })
})

describe('heredocs', () => {
  test('body lines are not split into separate command segments', () => {
    const command = [
      "cat > CHANGES_SUMMARY.md << 'EOF'",
      '# Taskband Start Menu Priority Fix',
      '## Overview',
      '**Before:**',
      'WINTC_BUTTONS_OK,',
      'EOF',
    ].join('\n')

    const analysis = analyzeShellCommand(command, [])
    expect(analysis.patterns).toEqual(['cat'])
    expect(analysis.unapproved).toEqual([])
    // Still requires approval: writing to a real file is a risky redirect.
    expect(analysis.unsafe).toBe(true)
  })

  test('supports <<- with tab-indented terminator', () => {
    const command = ["cat <<- 'EOF'", '\tsome body text', '\tEOF'].join('\n')
    const analysis = analyzeShellCommand(command, [])
    expect(analysis.patterns).toEqual(['cat'])
    expect(analysis.unapproved).toEqual([])
  })

  test('unquoted delimiter works and body is still opaque', () => {
    const command = ['cat << EOF', 'rm -rf dist', 'EOF'].join('\n')
    const analysis = analyzeShellCommand(command, [])
    expect(analysis.patterns).toEqual(['cat'])
    expect(analysis.unapproved).toEqual([])
  })

  test('a command chained after the heredoc is still analyzed normally', () => {
    const command = ["cat << 'EOF'", 'body line', 'EOF', 'rm -rf dist'].join(
      '\n',
    )
    const analysis = analyzeShellCommand(command, [])
    expect(analysis.patterns).toEqual(['cat', 'rm'])
    expect(analysis.unapproved).toEqual(['rm'])
  })
})

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

  test('shell -c scripts match exactly', () => {
    const { patterns } = analyzeShellCommand("sh -c 'rm -rf /'", [])
    expect(patterns).toEqual(['sh rm -rf /'])
    expect(isShellCommandAutoApproved("sh -c 'rm -rf /'", [])).toBe(false)
  })
})

describe('extractPathCandidates', () => {
  test('collects non-flag words from every chain segment', () => {
    expect(extractPathCandidates('cat .env && ls dist')).toEqual([
      'cat',
      '.env',
      'ls',
      'dist',
    ])
  })

  test('includes --flag=value and env assignment values, skips bare flags', () => {
    expect(extractPathCandidates('grep -rn --file=.env.local foo')).toEqual([
      'grep',
      '.env.local',
      'foo',
    ])
    expect(extractPathCandidates('DOTENV_PATH=.env ls -la')).toEqual([
      '.env',
      'ls',
    ])
  })

  test('keeps glob tokens for sidecar expansion', () => {
    expect(extractPathCandidates('cat .env*')).toEqual(['cat', '.env*'])
  })

  test('skips redirect leftovers and dedupes', () => {
    expect(extractPathCandidates('wc -l < notes.txt')).toEqual([
      'wc',
      'notes.txt',
    ])
    expect(extractPathCandidates('ls a; ls a')).toEqual(['ls', 'a'])
  })

  test('skips match-pattern flag arguments', () => {
    expect(
      extractPathCandidates("find src -name '*.ts' -not -path '*/dist/*'"),
    ).toEqual(['find', 'src'])
    expect(extractPathCandidates('grep --exclude-dir=.git foo src')).toEqual([
      'grep',
      'foo',
      'src',
    ])
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

  test('positional and non-pattern flag references still count', () => {
    expect(commandReferencesForbiddenPath('find .git -type f')).toBe(true)
    expect(commandReferencesForbiddenPath('grep --file=.git/config x')).toBe(
      true,
    )
    expect(commandReferencesForbiddenPath('cat .git/config')).toBe(true)
  })
})
