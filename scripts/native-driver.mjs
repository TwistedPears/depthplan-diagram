import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Slower CI hosts scale every wait instead of each scenario guessing its own.
const timeoutScale = Number(process.env.NATIVE_TIMEOUT_SCALE) || 1;
const describe = (value) => {
  try {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 2000 ? text.slice(0, 2000) + '…' : text;
  } catch {
    return String(value);
  }
};

// Polls until fn returns a truthy value and returns it. A string option is the
// label; on timeout the error names what was awaited and the last value seen.
export async function until(fn, options = {}) {
  const {
    label = 'condition',
    timeout = 20000,
    interval = 100,
    last,
    snapshot,
  } = typeof options === 'string' ? { label: options } : options;
  const limit = timeout * timeoutScale;
  const deadline = Date.now() + limit;
  let value;
  for (;;) {
    value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, interval));
  }
  let message = `${label} (timed out after ${limit}ms; last value: ${describe(last ? last() : value)})`;
  if (snapshot)
    message += `\nApp state: ${await snapshot().then(describe, (error) => `unavailable: ${error.message}`)}`;
  throw new Error(message);
}

// The app replies with retryable errors (BUSY, APP_UNAVAILABLE) during
// transitions. The protocol says to retry the same request, so waiting here
// follows the contract rather than hiding a failure.
export async function mcpCall(probe, name, args) {
  let reply;
  await until(
    async () => {
      reply = await probe.call(name, args);
      return reply.ok || !reply.error?.retryable;
    },
    { label: `${name} to stop returning retryable errors`, last: () => reply },
  );
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply;
}

export const mcpState = async (probe, args) =>
  (await mcpCall(probe, 'depthplan_get_state', args)).data;

export async function mcpCommand(probe, name, args) {
  const current = await mcpState(probe);
  return mcpCall(probe, name, {
    handle: current.handle,
    expectedRevision: current.revision,
    expectedViewRevision: current.viewRevision,
    requestId: randomUUID(),
    ...args,
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export const clickToPaint = (driver, label) =>
  driver.js(
    'new Promise((resolve,reject)=>{const label=arguments[0];const b=Array.from((document.querySelector("dialog[open]")||document).querySelectorAll("button")).find(b=>b.getClientRects().length && (b.getAttribute("aria-label")===label||b.textContent.trim()===label||b.title===label));if(!b||b.disabled||b.closest("[inert]"))return reject(new Error("Missing/disabled button "+label));const start=performance.now();b.click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)))})',
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
  // A fresh port per launch keeps a slow-exiting previous app from answering.
  const port = Number(process.env.TAURI_WEBDRIVER_PORT) || (await freePort());
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
  const frames = () =>
    js(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  // Read on timeout so failures show what the app was doing, not just "Timed out".
  const snapshot = async () => {
    if (app.exitCode !== null || app.signalCode !== null)
      return { exit: app.exitCode, signal: app.signalCode };
    return sync(
      `const dialog=document.querySelector('dialog[open]');
       return {viewport:[innerWidth,innerHeight],canvas:window.depthplanCanvasState?.()??null,
         dialog:dialog&&(dialog.getAttribute('aria-label')||dialog.querySelector('h1,h2,h3')?.textContent||dialog.id||true),
         focus:document.activeElement?.getAttribute('aria-label')||document.activeElement?.tagName,
         errors:window.nativeErrors}`,
    );
  };
  const scopedUntil = (fn, options = {}) =>
    until(fn, {
      snapshot: session ? snapshot : undefined,
      ...(typeof options === 'string' ? { label: options } : options),
    });
  // Canvas gestures are dropped while the editor is busy, animating or behind a
  // dialog. Wait for the app's own state, held across a painted frame.
  const idle = (label = 'canvas to accept gestures') => {
    const ready = () =>
      sync(
        'const s=window.depthplanCanvasState?.(); return !!s && !s.busy && !s.animating && !document.querySelector("dialog[open]")',
      );
    return scopedUntil(
      async () => (await ready()) && (await frames(), await ready()),
      label,
    );
  };
  // Synthetic mouse event at a viewport point; a point outside the viewport
  // fails with its coordinates instead of a null dereference in the page.
  const pointer = async (type, point, init = {}) => {
    await sync(
      `const [type,p,init]=arguments;
       const target=document.elementFromPoint(p.x,p.y);
       if(!target)throw new Error('No element at '+p.x+','+p.y+' in a '+innerWidth+'x'+innerHeight+' viewport');
       target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,button:0,buttons:type==='mouseup'?0:1,...init}));`,
      [type, point, init],
    );
    await frames();
  };
  const click = async (label) => {
    // MCP state can advance before React paints the toolbar for that selection.
    await frames();
    await scopedUntil(
      () =>
        sync(
          'const b=Array.from((document.querySelector("dialog[open]")||document).querySelectorAll("button")).find(b=>b.getClientRects().length && (b.getAttribute("aria-label")===arguments[0]||b.textContent.trim()===arguments[0]||b.title===arguments[0]));if(!b||b.disabled||b.closest("[inert]"))return false;return true',
          [label],
        ),
      `Button ${label} to be enabled`,
    );
    // Settle React effects and Konva hit-canvas paint before the next gesture.
    await clickToPaint({ js }, label);
  };
  const closeBoard = async (boardId) => {
    if (!(await sync('return !!document.querySelector("#project-drawer")')))
      await click('Toggle project boards');
    await scopedUntil(
      () =>
        sync(
          `const board=document.getElementById(arguments[0]); if(!board || board.disabled)return false;
       board.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})); return true`,
          [`board-link-${boardId}`],
        ),
      `Board ${boardId} link to open its menu`,
    );
    await click('Close board');
    await scopedUntil(
      () =>
        sync('return !document.getElementById(arguments[0])', [
          `board-${boardId}`,
        ]),
      `Board ${boardId} to close`,
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
         if(!target)throw new Error('No element at '+cx+','+cy+' in a '+innerWidth+'x'+innerHeight+' viewport');
         target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:cx,clientY:cy,button,buttons}));
       }`,
      [x, y, dx, dy, button],
    );
  async function close() {
    if (app.exitCode !== null || app.signalCode !== null || !app.pid) return;
    const exited = new Promise((resolve) => app.once('exit', resolve));
    app.kill();
    const force = setTimeout(() => app.kill('SIGKILL'), 2000);
    // Wait for the exit itself so the next launch never meets this process.
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
    clearTimeout(force);
  }
  try {
    await until(
      async () => {
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
      },
      { label: `WebDriver on port ${port}`, timeout: 60000 },
    );
    session = (await request('/session', { capabilities: { alwaysMatch: {} } }))
      .sessionId;
    await request(`/session/${session}/window/rect`, {
      width: 1280,
      height: 900,
    });
    // The driver's script-result global can disappear during initial navigation.
    // Reading the title uses one native evaluation, without that polling global.
    await until(
      async () =>
        (await request(`/session/${session}/title`, undefined, 'GET')) ===
        'DepthPlan',
      { label: 'The application document', timeout: 30000 },
    );
    await until(
      () =>
        sync(
          'return !!window.desktop && !!document.querySelector("canvas, .project-navigation")',
        ),
      { label: 'The desktop bridge and first view', timeout: 30000 },
    );
    await sync(
      'window.nativeErrors=[];addEventListener("error",e=>window.nativeErrors.push(e.message));addEventListener("unhandledrejection",e=>window.nativeErrors.push(String(e.reason)))',
    );
    // Hosted desktops can clamp the requested window. Coordinates are only
    // portable when every scenario knows the viewport it actually got.
    const viewport = await sync('return {width:innerWidth,height:innerHeight}');
    if (viewport.width < 1200 || viewport.height < 800)
      console.warn(
        `Native viewport is ${viewport.width}x${viewport.height}, smaller than the requested 1280x900 window`,
      );
    return {
      binary,
      adapter,
      profile,
      app,
      port,
      session,
      request,
      sync,
      js,
      native,
      dialogs,
      click,
      closeBoard,
      drag,
      pointer,
      frames,
      idle,
      viewport,
      until: scopedUntil,
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
