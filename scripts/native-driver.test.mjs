import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  clickToPaint,
  launchNative,
  mcpCall,
  mcpCommand,
  until,
} from './native-driver.mjs';

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

test('timed clicks ignore hidden and inert controls, pass labels as data and retain timing and errors', async () => {
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
        closest: () => null,
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
    buttons[1].disabled = false;
    buttons[1].closest = (selector) => (selector === '[inert]' ? {} : null);
    await assert.rejects(clickToPaint(driver, label), {
      message: `Missing/disabled button ${label}`,
    });
    buttons[1].closest = () => null;
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

test('until returns the first truthy value and names what timed out', async () => {
  let reads = 0;
  assert.equal(
    await until(() => ++reads === 3 && 'ready', { interval: 1 }),
    'ready',
  );
  await assert.rejects(
    until(() => false, {
      last: () => ({ open: false }),
      label: 'Menu to open',
      timeout: 30,
      interval: 5,
      snapshot: async () => ({ busy: true }),
    }),
    (error) =>
      /^Menu to open \(timed out after 30ms; last value: \{"open":false\}\)/.test(
        error.message,
      ) && error.message.includes('App state: {"busy":true}'),
  );
  await assert.rejects(
    until(() => false, { timeout: 1 }),
    { message: /^condition \(timed out after 1ms; last value: false\)$/ },
  );
  await assert.rejects(
    until(() => {
      throw new Error('probe failed');
    }),
    { message: 'probe failed' },
  );
});

test('MCP calls retry only retryable errors and keep the same request', async () => {
  const calls = [];
  const replies = [
    { ok: true, data: { handle: 'h', revision: 4, viewRevision: 2 } },
    { ok: false, error: { code: 'BUSY', retryable: true } },
    { ok: false, error: { code: 'APP_UNAVAILABLE', retryable: true } },
    { ok: true, data: 'done' },
  ];
  const probe = {
    call: async (name, args) => {
      calls.push({ name, args });
      return replies.shift();
    },
  };
  assert.equal(
    (await mcpCommand(probe, 'depthplan_edit', { actions: [] })).data,
    'done',
  );
  assert.deepEqual(
    calls.map((call) => call.name),
    ['depthplan_get_state', ...Array(3).fill('depthplan_edit')],
  );
  const edits = calls.slice(1).map((call) => call.args);
  assert.equal(new Set(edits.map((args) => args.requestId)).size, 1);
  assert.deepEqual(
    { ...edits[0], requestId: undefined },
    {
      handle: 'h',
      expectedRevision: 4,
      expectedViewRevision: 2,
      requestId: undefined,
      actions: [],
    },
  );
  const stale = {
    ok: false,
    error: { code: 'STALE_SESSION', retryable: false },
  };
  let staleCalls = 0;
  await assert.rejects(
    mcpCall({ call: async () => (staleCalls++, stale) }, 'depthplan_get_state'),
    /STALE_SESSION/,
  );
  assert.equal(staleCalls, 1);
});

test('each launch gets a free WebDriver port and close waits for the app to exit', async () => {
  const previous = process.env.TAURI_WEBDRIVER_PORT;
  delete process.env.TAURI_WEBDRIVER_PORT;
  // A stand-in app that serves just enough WebDriver on the port it is given.
  const app = `require('node:http').createServer((request, response) => {
    let value = null;
    if (request.url === '/session') value = { sessionId: 'free-port' };
    if (request.url.endsWith('/title')) value = 'DepthPlan';
    if (request.url.endsWith('/execute/sync')) value = 'true';
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ value }));
  }).listen(Number(process.env.TAURI_WEBDRIVER_PORT), '127.0.0.1');`;
  const previousExecutable = process.env.DEPTHPLAN_EXECUTABLE;
  process.env.DEPTHPLAN_EXECUTABLE = process.execPath;
  const drivers = [];
  try {
    for (let i = 0; i < 2; i++) {
      const driver = await launchNative(undefined, ['-e', app]);
      drivers.push(driver);
      await driver.close();
      assert(driver.app.exitCode !== null || driver.app.signalCode !== null);
    }
    const ports = drivers.map((driver) => driver.port);
    assert.equal(new Set(ports).size, 2);
    assert(ports.every((port) => port > 0 && port !== 4467));
  } finally {
    for (const driver of drivers) await driver.close();
    if (previous === undefined) delete process.env.TAURI_WEBDRIVER_PORT;
    else process.env.TAURI_WEBDRIVER_PORT = previous;
    if (previousExecutable === undefined)
      delete process.env.DEPTHPLAN_EXECUTABLE;
    else process.env.DEPTHPLAN_EXECUTABLE = previousExecutable;
  }
});
