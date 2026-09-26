import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const clickToPaint = (driver, label) =>
  driver.js(
    'new Promise((resolve,reject)=>{const label=arguments[0];const b=Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")===label||b.textContent.trim()===label||b.title===label);if(!b||b.disabled)return reject(new Error("Missing/disabled button "+label));const start=performance.now();b.click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)))})',
    [label],
  );

export async function launchNative(existingProfile, fileArguments = []) {
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
  const app = spawn(binary, fileArguments, {
    env: {
      ...process.env,
      DEPTHPLAN_TEST_PROFILE: profile,
      TAURI_WEBDRIVER_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  const capture = (s) => (diagnostics = (diagnostics + s).slice(-65536));
  app.stdout.on('data', capture);
  app.stderr.on('data', capture);
  let spawnError;
  app.on('error', (e) => {
    spawnError = e;
    capture(e.message);
  });
  const base = `http://127.0.0.1:${port}`;
  let session;
  async function request(route, body, method = 'POST') {
    const r = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    }).catch((error) => {
      throw new Error(
        `WebDriver ${method} ${route}: ${error.message}; app exit=${app.exitCode}, signal=${app.signalCode}\n${diagnostics}`,
        { cause: error },
      );
    });
    const bodyText = await r.text();
    assert.equal(r.ok, true, `WebDriver ${r.status}: ${bodyText}`);
    const result = JSON.parse(bodyText);
    assert.equal(result.value?.error, undefined, JSON.stringify(result));
    return result.value;
  }
  // WebKitGTK marshals objects through an unordered map. Carry JSON text so
  // reading an ordered document through WebDriver cannot change its contents.
  const sync = (script, args = []) =>
    request(`/session/${session}/execute/sync`, {
      script: `return JSON.stringify((function(){${script}\n}).apply(null,JSON.parse(arguments[0])))`,
      args: [JSON.stringify(args)],
    }).then(JSON.parse);
  const js = (expression, args = []) =>
    request(`/session/${session}/execute/async`, {
      script: `const done=arguments[arguments.length-1],args=JSON.parse(arguments[0]); Promise.resolve().then(()=>(function(){return (${expression})}).apply(null,args)).then(value=>done(JSON.stringify({value}))).catch(error=>done(JSON.stringify({failure:String(error)})))`,
      args: [JSON.stringify(args)],
    }).then((text) => {
      const result = JSON.parse(text);
      assert.equal(result.failure, undefined, result.failure);
      return result.value;
    });
  const native = (method, ...args) =>
    js(
      'window.__TAURI_INTERNALS__.invoke("desktop", {method:arguments[0],args:arguments[1]})',
      [method, args],
    );
  const dialogs = (kind, value) => native('test:dialogs', [{ kind, value }]);
  const click = async (label) => {
    // MCP state can advance before React paints the toolbar for that selection.
    await js(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await until(
      () =>
        sync(
          'const b=Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")===arguments[0]||b.textContent.trim()===arguments[0]||b.title===arguments[0]);if(!b)return false;b.click();return true',
          [label],
        ),
      `Timed out waiting for button ${label}`,
    );
  };
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
  async function until(fn, message = 'Timed out') {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(message);
  }
  async function close() {
    if (app.exitCode !== null || app.signalCode !== null || !app.pid) return;
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
      if (spawnError) throw spawnError;
      if (app.exitCode !== null || app.signalCode !== null)
        throw new Error(`App exited (${app.signalCode ?? app.exitCode})`);
      try {
        return (
          await fetch(base + '/status', { signal: AbortSignal.timeout(1000) })
        ).ok;
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
      diagnostics: () => diagnostics,
    };
  } catch (error) {
    await close();
    throw new Error(`Native startup failed: ${error.message}\n${diagnostics}`, {
      cause: error,
    });
  }
}
