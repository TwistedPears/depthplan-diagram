import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export async function launchNative(existingProfile) {
  const binary = path.resolve(
    process.env.DEPTHPLAN_EXECUTABLE ||
      'src-tauri/target/debug/depthplan' +
        (process.platform === 'win32' ? '.exe' : ''),
  );
  const adapter = path.join(
    path.dirname(binary),
    'depthplan-mcp' + (process.platform === 'win32' ? '.exe' : ''),
  );
  const profile =
    existingProfile ??
    (await mkdtemp(path.join(tmpdir(), 'depthplan-tauri-smoke-')));
  const port = Number(process.env.TAURI_WEBDRIVER_PORT || 4467);
  const app = spawn(binary, [], {
    env: {
      ...process.env,
      DEPTHPLAN_TEST_PROFILE: profile,
      TAURI_WEBDRIVER_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  app.stdout.on('data', (s) => (diagnostics += s));
  app.stderr.on('data', (s) => (diagnostics += s));
  app.on('error', (e) => {
    diagnostics += e.message;
  });
  const base = `http://127.0.0.1:${port}`;
  let session;
  async function request(route, body, method = 'POST') {
    const r = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    const bodyText = await r.text();
    assert.equal(r.ok, true, `WebDriver ${r.status}: ${bodyText}`);
    const result = JSON.parse(bodyText);
    assert.equal(result.value?.error, undefined, JSON.stringify(result));
    return result.value;
  }
  const sync = (script, args = []) =>
    request(`/session/${session}/execute/sync`, { script, args });
  const js = (expression, args = []) =>
    request(`/session/${session}/execute/async`, {
      script: `const done=arguments[arguments.length-1]; Promise.resolve().then(()=>(${expression})).then(value=>done({value}),error=>done({failure:String(error)}))`,
      args,
    }).then((result) => {
      assert.equal(result.failure, undefined, result.failure);
      return result.value;
    });
  const native = (method, ...args) =>
    js(
      'window.__TAURI_INTERNALS__.invoke("desktop", {method:arguments[0],args:arguments[1]})',
      [method, args],
    );
  const dialogs = (kind, value) => native('test:dialogs', [{ kind, value }]);
  const click = (label) =>
    sync(
      'const b=Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")===arguments[0]||b.textContent.trim()===arguments[0]||b.title===arguments[0]);if(!b)throw new Error("Missing button "+arguments[0]);b.click()',
      [label],
    );
  // The embedded driver's Actions implementation uses 1 << button (right=4)
  // and drops held buttons on move. Dispatch spec-correct DOM mouse events.
  // This exercises WKWebView handlers, not OS input or hardware latency.
  const drag = (x, y, dx, dy, button = 2) =>
    sync(
      `const [x,y,dx,dy,button]=arguments; const held=button===2?2:1;
       for(const [type,cx,cy,buttons] of [['mousedown',x,y,held],['mousemove',x+dx,y+dy,held],['mouseup',x+dx,y+dy,0]]) {
         const target=document.elementFromPoint(cx,cy);
         if(!target)throw new Error('Pointer outside the document');
         target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:cx,clientY:cy,button,buttons}));
       }`,
      [x, y, dx, dy, button],
    );
  async function until(fn) {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out');
  }
  async function close() {
    app.kill();
    if (app.exitCode === null)
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          app.kill('SIGKILL');
          resolve();
        }, 2000);
        app.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
  }
  try {
    await until(async () => {
      if (app.exitCode !== null) throw new Error(`App exited: ${diagnostics}`);
      try {
        return (await fetch(base + '/status')).ok;
      } catch {
        return false;
      }
    });
    session = (await request('/session', { capabilities: { alwaysMatch: {} } }))
      .sessionId;
    await request(`/session/${session}/window/rect`, {
      width: 1280,
      height: 900,
    });
    await until(() =>
      sync('return !!window.desktop && !!document.querySelector("canvas")'),
    );
    await sync(
      'window.nativeErrors=[];addEventListener("error",e=>window.nativeErrors.push(e.message));addEventListener("unhandledrejection",e=>window.nativeErrors.push(String(e.reason)))',
    );
    return {
      binary,
      adapter,
      profile,
      app,
      session,
      request,
      sync,
      js,
      native,
      dialogs,
      click,
      drag,
      until,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
