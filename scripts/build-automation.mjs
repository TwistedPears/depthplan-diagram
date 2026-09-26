import { spawnSync } from 'node:child_process';
const child = spawnSync(
  'cargo',
  [
    ...(process.argv.includes('--test')
      ? ['test', '--lib']
      : ['build', '--features', 'automation,custom-protocol', '--bins']),
    ...((process.argv.includes('--test') && process.platform === 'linux') ||
    process.argv.includes('--release')
      ? ['--release']
      : []),
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      TAURI_CONFIG: JSON.stringify({
        bundle: { active: false, externalBin: [], resources: [] },
      }),
    },
  },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
