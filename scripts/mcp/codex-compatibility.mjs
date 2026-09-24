import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const codex = process.env.DEPTHPLAN_CODEX_BIN || 'codex';
// Read names only; never copy credentials or change the user's Codex configuration.
const existing = JSON.parse(
  execFileSync(
    'python3',
    [
      '-c',
      'import pathlib,tomllib,json; p=pathlib.Path.home()/".codex/config.toml"; print(json.dumps(list(tomllib.loads(p.read_text()).get("mcp_servers",{})) if p.exists() else []))',
    ],
    { encoding: 'utf8' },
  ),
);
const temporary = mkdtempSync(resolve(tmpdir(), 'depthplan-mcp-probe-'));
const args = [
  'app-server',
  '-c',
  'features.plugins=false',
  '-c',
  'features.apps=false',
  '-c',
  `sqlite_home=${JSON.stringify(temporary)}`,
];
for (const name of existing)
  args.push('-c', `mcp_servers.${name}.enabled=false`);
const server = fileURLToPath(new URL('./contract-server.mjs', import.meta.url));
const configuration = process.env.DEPTHPLAN_CODEX_CONFIGURATION;
const live = configuration
  ? JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import sys,tomllib,json; print(json.dumps(tomllib.loads(sys.stdin.read())["mcp_servers"]["depthplan"]))',
        ],
        { input: readFileSync(configuration, 'utf8'), encoding: 'utf8' },
      ),
    )
  : null;
const entry = live
  ? `command=${JSON.stringify(live.command)},args=${JSON.stringify(live.args)},enabled=true`
  : `command=${JSON.stringify(process.execPath)},args=["--experimental-strip-types",${JSON.stringify(server)}],enabled=true,env={DEPTHPLAN_PROBE_RESULT=${JSON.stringify(resolve(temporary, 'protocol'))}}`;
args.push('-c', `mcp_servers.depthplan_spike={${entry}}`);
const child = spawn(codex, args, {
  cwd: temporary,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const closed = new Promise((resolve) => child.once('close', resolve));
const pending = new Map();
let sequence = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  const response = JSON.parse(line);
  if (pending.has(response.id)) {
    const { resolve, reject } = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) reject(new Error(JSON.stringify(response.error)));
    else resolve(response.result);
  }
});
// Diagnostics stay private unless the probe fails; they may name local settings.
let diagnostics = '';
child.stderr.on('data', (data) => {
  diagnostics = (diagnostics + data).slice(-4000);
});
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
const timeout = setTimeout(() => child.kill(), 30000);
child.on('exit', () => {
  for (const { reject } of pending.values())
    reject(new Error('Codex probe exited: ' + diagnostics));
});
try {
  const initialized = await request('initialize', {
    clientInfo: { name: 'depthplan-compatibility', version: '0.1.0' },
  });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const inventory = await request('mcpServerStatus/list', {
    limit: 100,
    detail: 'toolsAndAuthOnly',
  });
  const status = inventory.data.find(
    (entry) => entry.name === 'depthplan_spike',
  );
  assert.ok(status, 'Codex must discover the fixture server');
  const names = Object.keys(status.tools)
    .map((key) => status.tools[key].name)
    .sort();
  assert.deepEqual(
    names,
    live
      ? [
          'depthplan_bookmarks',
          'depthplan_camera',
          'depthplan_cancel_operation',
          'depthplan_content_transfer',
          'depthplan_controls',
          'depthplan_decide',
          'depthplan_delete_preview',
          'depthplan_edit',
          'depthplan_export',
          'depthplan_files',
          'depthplan_get_access',
          'depthplan_get_context',
          'depthplan_get_drafts',
          'depthplan_get_hierarchy',
          'depthplan_get_operation',
          'depthplan_get_recovery',
          'depthplan_get_state',
          'depthplan_history',
          'depthplan_query',
          'depthplan_read_chunk',
          'depthplan_recovery',
          'depthplan_resolve_draft',
          'depthplan_reveal_all',
          'depthplan_selection',
          'depthplan_set_depth',
        ]
      : [
          'depthplan_get_context',
          'depthplan_get_hierarchy',
          'depthplan_reveal_all',
          'depthplan_set_depth',
        ],
  );
  assert.equal(
    inventory.data.filter((entry) => Object.keys(entry.tools).length).length,
    1,
    'Only the fixture server may be connected',
  );
  console.log(
    JSON.stringify(
      {
        client: execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim(),
        platform: initialized.platformOs,
        protocol: live
          ? null
          : readFileSync(resolve(temporary, 'protocol'), 'utf8'),
        target: live
          ? 'live packaged adapter; discovery only'
          : 'contract fixture',
        desktopClientTested: false,
        tools: names,
        passed: true,
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(timeout);
  lines.close();
  child.stdin.end();
  child.kill();
  await closed;
  rmSync(temporary, { recursive: true, force: true });
}
