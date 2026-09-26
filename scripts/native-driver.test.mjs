import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { clickToPaint } from './native-driver.mjs';

test('timed clicks pass labels as data and retain timing and errors', async () => {
  const label =
    '\'"\\\n</script><script>throw new Error("injected")</script>\u2028\u2029 end';
  let frames = 0;
  let clicks = 0;
  let buttons = [];
  const driver = {
    js(expression, args) {
      assert.deepEqual(args, [label]);
      assert(!expression.includes(label));
      return runInNewContext(expression, {
        arguments: args,
        document: { querySelectorAll: () => buttons },
        performance: { now: () => frames * 16 },
        requestAnimationFrame: (callback) => {
          frames++;
          callback();
        },
      });
    },
  };
  for (const match of ['aria-label', 'text', 'title']) {
    buttons = [
      {
        getAttribute: () => (match === 'aria-label' ? label : null),
        textContent: match === 'text' ? ` ${label} ` : '',
        title: match === 'title' ? label : '',
        click: () => clicks++,
      },
    ];
    assert.equal(await clickToPaint(driver, label), 32);
    buttons[0].disabled = true;
    await assert.rejects(clickToPaint(driver, label), {
      message: `Missing/disabled button ${label}`,
    });
  }
  buttons = [];
  await assert.rejects(clickToPaint(driver, label), {
    message: `Missing/disabled button ${label}`,
  });
  assert.equal(clicks, 3);
  assert.equal(frames, 6);
});

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
