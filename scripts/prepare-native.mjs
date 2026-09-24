import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
const debug = process.argv.includes('--debug');
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(
  /^host: (.+)$/m,
)[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const result = spawnSync(
  'cargo',
  [
    'build',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--bin',
    'depthplan-mcp',
    ...(debug ? [] : ['--release']),
    ...(target === host ? [] : ['--target', target]),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      TAURI_CONFIG: JSON.stringify({
        bundle: { externalBin: [], resources: [] },
      }),
    },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const extension = target.includes('windows') ? '.exe' : '';
const directory = path.join(
  process.env.CARGO_TARGET_DIR || 'src-tauri/target',
  ...(target === host ? [] : [target]),
  debug ? 'debug' : 'release',
);
mkdirSync('src-tauri/binaries', { recursive: true });
copyFileSync(
  path.join(directory, 'depthplan-mcp' + extension),
  `src-tauri/binaries/depthplan-mcp-${target}${extension}`,
);
