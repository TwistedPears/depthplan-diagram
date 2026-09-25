import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import path from 'node:path';

function failure(binary, args = []) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { launchNative } from './scripts/native-driver.mjs';
       const driver = await launchNative(undefined, JSON.parse(process.argv[1]));
       await driver.close();`,
      JSON.stringify(args),
    ],
    {
      env: {
        ...process.env,
        DEPTHPLAN_EXECUTABLE: binary,
        TAURI_WEBDRIVER_PORT: '0',
      },
      encoding: 'utf8',
      timeout: 20000,
    },
  );
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  return result.stderr;
}

test('native startup reports the child exit and captured stderr', () => {
  assert.match(
    failure(process.execPath, [
      '-e',
      'process.stderr.write("startup diagnostic"); process.exit(42)',
    ]),
    /42[\s\S]*startup diagnostic/,
  );
});

test('native startup reports a missing executable', () => {
  assert.match(failure(path.resolve('missing-native-test-binary')), /ENOENT/);
});

test(
  'native startup reports signal termination',
  { skip: process.platform === 'win32' },
  () => {
    assert.match(
      failure(process.execPath, [
        '-e',
        'process.stderr.write("signal diagnostic"); process.kill(process.pid, "SIGTERM")',
      ]),
      /SIGTERM[\s\S]*signal diagnostic/,
    );
  },
);
