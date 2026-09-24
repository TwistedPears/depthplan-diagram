const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function client(executable, descriptor) {
  const child = spawn(executable, ['--descriptor', descriptor], {
    env: {
      ...process.env,
      PATH:
        process.platform === 'win32'
          ? process.env.SystemRoot + '/System32'
          : '/usr/bin:/bin',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let next = 0;
  const pending = new Map();
  let diagnostic = '';
  child.stderr.on('data', (chunk) => (diagnostic += chunk));
  createInterface({ input: child.stdout }).on('line', (line) => {
    const response = JSON.parse(line);
    const waiting = pending.get(response.id);
    if (waiting) {
      clearTimeout(waiting.timer);
      pending.delete(response.id);
      waiting.resolve(response);
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(
        () => reject(new Error('MCP timeout: ' + method + ' ' + diagnostic)),
        10000,
      );
      pending.set(id, { resolve, timer });
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
      );
    });
  return {
    child,
    request,
    async call(name, args = {}) {
      const response = await request('tools/call', { name, arguments: args });
      assert.ok(response.result, JSON.stringify(response));
      const result = response.result;
      assert.deepEqual(
        JSON.parse(result.content[0].text),
        result.structuredContent,
      );
      assert.equal(result.isError, !result.structuredContent.ok);
      return result.structuredContent;
    },
    async initialize() {
      const result = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'depthplan-native-probe', version: '1' },
      });
      assert.ok(result.result);
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }) + '\n',
      );
      const list = await request('tools/list', {});
      assert.deepEqual(list.result.tools.map((tool) => tool.name).sort(), [
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
      ]);
    },
    close() {
      child.stdin.end();
      child.kill();
      for (const value of pending.values()) clearTimeout(value.timer);
    },
  };
}
module.exports = client;
