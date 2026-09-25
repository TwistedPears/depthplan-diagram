import { execFileSync } from 'node:child_process';
import path from 'node:path';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run check:local.');

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}

const npm = (...args) => run(process.execPath, [npmCli, ...args]);

// Fail early if a prerequisite for audits or the ordinary build is missing.
run('cargo', ['audit', '--version']);
run('cargo', ['about', '--version']);

for (const script of [
  'format:check',
  'format:rust:check',
  'lint',
  'typecheck',
  'test:hooks',
]) {
  npm('run', script);
}
npm('test', '--', '--runInBand');
run(process.execPath, ['--test', 'scripts/native-driver.test.mjs']);
if (process.platform === 'win32') {
  run(
    path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      'scripts/test-windows-acl.ps1',
    ],
  );
}
npm('run', 'test:native');
npm('run', 'build:automation');
run(
  'cargo',
  [
    'clippy',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--all-targets',
    '--all-features',
    '--',
    '-D',
    'warnings',
  ],
  {
    env: {
      ...process.env,
      TAURI_CONFIG: JSON.stringify({
        bundle: { active: false, externalBin: [], resources: [] },
      }),
    },
  },
);

// Use the automation build from this run, including a custom Cargo target dir.
const smokeOptions = {
  env: {
    ...process.env,
    DEPTHPLAN_EXECUTABLE: path.resolve(
      process.env.CARGO_TARGET_DIR || 'src-tauri/target',
      'debug',
      process.platform === 'win32' ? 'depthplan.exe' : 'depthplan',
    ),
  },
};
const smokeArgs = [npmCli, 'run', 'smoke:ci'];
if (
  process.platform === 'linux' &&
  !process.env.DISPLAY &&
  !process.env.WAYLAND_DISPLAY
) {
  run(
    'xvfb-run',
    ['--auto-servernum', process.execPath, ...smokeArgs],
    smokeOptions,
  );
} else {
  run(process.execPath, smokeArgs, smokeOptions);
}
npm('run', 'build');
const dependencies = run(
  'cargo',
  [
    'tree',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '-e',
    'normal',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
if (dependencies.includes('tauri-plugin-wdio')) {
  throw new Error('The ordinary application must not include test automation.');
}
npm('audit');
run('cargo', ['audit', '--file', 'src-tauri/Cargo.lock']);
console.log(
  '\nLocal checks passed for this host. Review any dependency warnings.',
);
