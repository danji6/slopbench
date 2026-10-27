import {
  analyzeShellCommand,
  analyzeShellPathCandidates,
  isShellCommandAutoApproved,
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
  test('shell loop keywords are always approved', () => {
    const readOnlyLoop = 'for file in a b; do echo "$file"; done'
    expect(isShellCommandAutoApproved(readOnlyLoop, [])).toBe(true)
    expect(analyzeShellCommand(readOnlyLoop, []).patterns).toEqual([
      'for',
      'do',
      'echo',
      'done',
    ])
    expect(analyzeShellPathCandidates(readOnlyLoop)).toEqual({
      candidates: [],
      complete: true,
    })

    const mutatingLoop = 'for file in a b; do rm "$file"; done'
    expect(analyzeShellCommand(mutatingLoop, []).unapproved).toEqual(['rm'])
    expect(isShellCommandAutoApproved(mutatingLoop, [])).toBe(false)
  })

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
