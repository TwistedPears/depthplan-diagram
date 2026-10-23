import { execFileSync } from 'node:child_process';

// Opens a PR with `gh pr create`, running local checks first when it targets
// integration or release. Git has no pre-PR hook, so this stands in for one.
const args = process.argv.slice(2);

function base() {
  for (const [index, arg] of args.entries()) {
    if (arg === '--base' || arg === '-B') return args[index + 1];
    if (arg.startsWith('--base=')) return arg.slice('--base='.length);
  }
  return undefined;
}

const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, { stdio: 'inherit' });

if (['integration', 'release'].includes(base())) {
  const status = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  });
  if (status) {
    throw new Error('Commit or stash pending changes before opening the PR.');
  }
  run(process.execPath, [process.env.npm_execpath, 'run', 'check:local']);
}

run('gh', ['pr', 'create', ...args]);
