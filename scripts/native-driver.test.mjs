import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { clickToPaint, launchNative } from './native-driver.mjs';

test('startup waits for the application document before executing page scripts', async () => {
  let titleReads = 0;
  let scriptReads = 0;
  const server = createServer((request, response) => {
    let value = null;
    if (request.url === '/session') value = { sessionId: 'startup' };
    if (request.url.endsWith('/title'))
      value = ++titleReads < 2 ? '' : 'DepthPlan';
    if (request.url.endsWith('/execute/sync')) {
      scriptReads++;
      if (titleReads < 2) {
        response.writeHead(500);
        response.end('Script result lost during initial navigation');
        return;
      }
      value = 'true';
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ value }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = {
    DEPTHPLAN_EXECUTABLE: process.env.DEPTHPLAN_EXECUTABLE,
    TAURI_WEBDRIVER_PORT: process.env.TAURI_WEBDRIVER_PORT,
  };
  let driver;
  try {
    process.env.DEPTHPLAN_EXECUTABLE = process.execPath;
    process.env.TAURI_WEBDRIVER_PORT = String(server.address().port);
    driver = await launchNative(undefined, ['-e', 'setInterval(()=>{},1000)']);
    assert.equal(titleReads, 2);
    assert(scriptReads > 0);
  } finally {
    await driver?.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test('timed clicks ignore hidden controls, pass labels as data and retain timing and errors', async () => {
  const label =
    '\'"\\\n</script><script>throw new Error("injected")</script>\u2028\u2029 end';
  let frames = 0;
  let clicks = 0;
  let buttons = [];
  let modalButtons;
  const driver = {
    js(expression, args) {
      assert.deepEqual(args, [label]);
      assert(!expression.includes(label));
      return runInNewContext(expression, {
        arguments: args,
        document: {
          querySelector: () =>
            modalButtons ? { querySelectorAll: () => modalButtons } : null,
          querySelectorAll: () => buttons,
        },
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
        getClientRects: () => [1],
        getAttribute: () => (match === 'aria-label' ? label : null),
        textContent: match === 'text' ? ` ${label} ` : '',
        title: match === 'title' ? label : '',
        click: () => clicks++,
      },
    ];
    buttons.unshift({
      ...buttons[0],
      getClientRects: () => [],
      click: () => assert.fail('Hidden button clicked'),
    });
    assert.equal(await clickToPaint(driver, label), 32);
    buttons[1].disabled = true;
    await assert.rejects(clickToPaint(driver, label), {
      message: `Missing/disabled button ${label}`,
    });
  }
  modalButtons = [{ ...buttons[1], disabled: false }];
  buttons = [
    {
      ...modalButtons[0],
      click: () => assert.fail('Background button clicked through a modal'),
    },
  ];
  assert.equal(await clickToPaint(driver, label), 32);
  modalButtons = undefined;
  buttons = [];
  await assert.rejects(clickToPaint(driver, label), {
    message: `Missing/disabled button ${label}`,
  });
  assert.equal(clicks, 4);
  assert.equal(frames, 8);
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
