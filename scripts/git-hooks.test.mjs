import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const hooks = fileURLToPath(new URL('../.githooks', import.meta.url));
const zero = '0'.repeat(40);

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'depthplan hooks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  mkdirSync(cwd);
  mkdirSync(bin);
  const log = path.join(root, 'checks.log');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('GIT_') && key.toUpperCase() !== 'PATH',
    ),
  );
  Object.assign(env, {
    PATH: `${bin}${path.delimiter}${process.env.PATH || process.env.Path}`,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig'),
    DEPTHPLAN_TEST_LOG: log,
    DEPTHPLAN_TEST_EXIT: '0',
  });
  writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  writeFileSync(
    path.join(bin, 'npm'),
    '#!/bin/sh\n' +
      'printf "%s\\n" "$*" >> "$DEPTHPLAN_TEST_LOG"\n' +
      'if [ "${DEPTHPLAN_TEST_MUTATE:-}" = 1 ]; then echo changed >> tracked.txt; fi\n' +
      'exit "$DEPTHPLAN_TEST_EXIT"\n',
    { mode: 0o755 },
  );
  function git(...args) {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  }
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Hook test');
  git('config', 'user.email', 'hook-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(cwd, 'tracked.txt'), 'initial\n');
  git('add', 'tracked.txt');
  git('commit', '-m', 'Initial');
  git('config', 'core.hooksPath', hooks);
  const head = git('rev-parse', 'HEAD');
  function hook(name, input = '') {
    const stdin = path.join(root, 'hook-input');
    writeFileSync(stdin, input);
    return spawnSync('git', ['hook', 'run', `--to-stdin=${stdin}`, name], {
      cwd,
      env,
      encoding: 'utf8',
    });
  }
  const push = () =>
    hook('pre-push', `refs/heads/main ${head} refs/heads/main ${zero}\n`);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim() : '');
  return { cwd, env, git, head, hook, push, calls };
}

test('pre-commit checks staged content rather than unstaged repairs', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, 'tracked.txt'), 'trailing whitespace \n');
  f.git('add', 'tracked.txt');
  writeFileSync(path.join(f.cwd, 'tracked.txt'), 'repaired only in worktree\n');
  assert.notEqual(f.hook('pre-commit').status, 0);
  f.git('add', 'tracked.txt');
  assert.equal(f.hook('pre-commit').status, 0);
});

test('pre-commit blocks staged conflict markers', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, 'tracked.txt'), '<<<<<<< HEAD\nconflict\n');
  f.git('add', 'tracked.txt');
  assert.notEqual(f.hook('pre-commit').status, 0);
});

test('pre-push runs validation once for a branch and annotated tag at HEAD', (t) => {
  const f = fixture(t);
  f.git('-c', 'tag.gpgsign=false', 'tag', '-a', 'v0.1.0', '-m', 'Candidate');
  const tag = f.git('rev-parse', 'v0.1.0');
  const result = f.hook(
    'pre-push',
    `refs/heads/main ${f.head} refs/heads/main ${zero}\nrefs/tags/v0.1.0 ${tag} refs/tags/v0.1.0 ${zero}\n`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls(), 'run check:local');
});

test('pre-push propagates a failing validation command', (t) => {
  const f = fixture(t);
  f.env.DEPTHPLAN_TEST_EXIT = '7';
  assert.notEqual(f.push().status, 0);
  assert.equal(f.calls(), 'run check:local');
});

test('pre-push skips no-op and deletion-only pushes', (t) => {
  const f = fixture(t);
  assert.equal(f.hook('pre-push').status, 0);
  assert.equal(
    f.hook('pre-push', `(delete) ${zero} refs/heads/old ${f.head}\n`).status,
    0,
  );
  assert.equal(f.calls(), '');
});

test('pre-push refuses a different commit from the checkout', (t) => {
  const f = fixture(t);
  f.git('commit', '--allow-empty', '-m', 'Next');
  assert.notEqual(f.push().status, 0);
  assert.equal(f.calls(), '');
});

test('pre-push refuses staged, unstaged and untracked changes', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, 'tracked.txt'), 'changed\n');
  assert.notEqual(f.push().status, 0);
  f.git('add', 'tracked.txt');
  assert.notEqual(f.push().status, 0);
  f.git('restore', '--staged', '--worktree', 'tracked.txt');
  writeFileSync(path.join(f.cwd, 'untracked.txt'), 'new\n');
  assert.notEqual(f.push().status, 0);
  assert.equal(f.calls(), '');
});

test('pre-push refuses changes produced during validation', (t) => {
  const f = fixture(t);
  f.env.DEPTHPLAN_TEST_MUTATE = '1';
  const result = f.push();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout changed during validation/);
});
