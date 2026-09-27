import client from './mcp/native-client.cjs';
// Ordinary artifacts only. OS associations and user profile writes stay on disposable CI hosts.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  readlink,
  writeFile,
  access,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec = promisify(execFile);
assert.equal(process.env.CI, 'true', 'Run only on a disposable CI desktop');
const temp = process.env.RUNNER_TEMP;
assert(temp, 'A disposable runner temp directory is required');
const evidence = path.join(temp, 'depthplan-installed');
await mkdir(evidence, { recursive: true });
const work = path.join(evidence, 'Files with spaces 演示');
await mkdir(work);
const config =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support')
    : process.platform === 'win32'
      ? process.env.APPDATA
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const workspaceFile = path.join(config, 'DepthPlan/workspaces.json');
assert.equal(
  await access(workspaceFile).then(
    () => true,
    () => false,
  ),
  false,
  'Refuse to reuse an existing production workspace',
);
const report = {
  platform: process.platform,
  release: os.release(),
  cpu: os.cpus()[0].model,
  commit: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(),
  phases: [],
  screenshotText: {},
  passed: false,
  scope:
    'Ordinary installed artifact; OS registration/cold and warm open, renderer workspace acknowledgement, clean native close, unchanged fixtures. Screenshots require visual review. This is automated-host evidence, not release certification.',
};
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const ps = async (action, value = '', extra = '') =>
  (
    await exec('pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.resolve('scripts/installed-windows.ps1'),
      action,
      value,
      extra,
    ])
  ).stdout.trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, message) => {
  for (let n = 0; n < 100; n++) {
    if (await fn()) return;
    await wait(200);
  }
  throw new Error(message);
};
const bundleRoot = path.resolve('src-tauri/target/release/bundle');
const suffix = { darwin: '.dmg', win32: '.exe', linux: '.deb' }[
  process.platform
];
const bundles = (await readdir(bundleRoot, { recursive: true })).filter(
  (file) => file.endsWith(suffix),
);
assert.equal(bundles.length, 1, `Expected one ${suffix} installer: ${bundles}`);
const installer = path.join(bundleRoot, bundles[0]);
report.installer = { file: bundles[0], sha256: await hash(installer) };
let binary, appPath, wm;
const processes = async () => {
  if (process.platform === 'win32') return JSON.parse(await ps('processes'));
  const rows = (await exec('ps', ['-axo', 'pid=,comm='])).stdout
    .trim()
    .split('\n');
  const found = [];
  for (const row of rows) {
    const match = row.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    let executable = match[2];
    // Linux comm is a basename; verify the actual installed executable via procfs.
    if (process.platform === 'linux' && executable === path.basename(binary))
      executable = await readlink(`/proc/${match[1]}/exe`).catch(() => null);
    if (executable === binary)
      found.push({ pid: Number(match[1]), path: executable });
  }
  return found;
};
const launch = async (file) => {
  if (process.platform === 'win32') await ps('open', file);
  else if (process.platform === 'linux') {
    assert.equal(
      (await exec('xdg-mime', ['query', 'filetype', file])).stdout.trim(),
      `application/x-${path.extname(file).slice(1)}`,
      'The desktop must recognize the installed file type',
    );
    // Generic xdg-open may wait for the app to exit; observe the app independently.
    await new Promise((resolve, reject) => {
      const opener = spawn('xdg-open', [file], { stdio: 'ignore' });
      opener.once('spawn', resolve);
      opener.once('error', reject);
      opener.unref();
    });
  } else await exec('open', [file]);
  await until(
    async () => (await processes()).length === 1,
    'Associated app did not start exactly once',
  );
  const [running] = await processes();
  assert.equal(running.path.toLowerCase(), binary.toLowerCase());
  return running.pid;
};
const capture = async (name, expected) => {
  await wait(3000);
  const file = path.join(evidence, `${name}.png`);
  if (process.platform === 'win32') await ps('capture', file);
  else if (process.platform === 'darwin' && expected)
    await until(async () => {
      await exec('screencapture', ['-x', file]);
      const { stdout } = await exec(path.join(evidence, 'read-text'), [file]);
      report.screenshotText[name] = stdout;
      return stdout.includes(expected);
    }, `Installed screenshot did not show ${expected}`);
  else
    await exec(
      process.platform === 'darwin' ? 'screencapture' : 'scrot',
      process.platform === 'darwin' ? ['-x', file] : [file],
    );
  assert((await readFile(file)).length > 1000, 'Empty installed screenshot');
};
const quit = async () => {
  const running = await processes();
  assert.equal(running.length, 1);
  if (process.platform === 'darwin')
    await exec('osascript', [
      '-e',
      'tell application id "com.twistedpears.depthplan" to quit',
    ]);
  else if (process.platform === 'win32')
    await ps('close', String(running[0].pid));
  else {
    const windows = (
      await exec('xdotool', [
        'search',
        '--onlyvisible',
        '--pid',
        String(running[0].pid),
      ])
    ).stdout
      .trim()
      .split('\n');
    assert(windows.length);
    await exec('xdotool', ['windowclose', windows[0]]);
  }
  await until(
    async () => !(await processes()).length,
    'Native clean close did not finish',
  );
};
try {
  if (process.platform === 'darwin') {
    await exec('swiftc', [
      'scripts/installed-macos.swift',
      '-o',
      path.join(evidence, 'read-text'),
    ]);
    const mount = path.join(evidence, 'mounted');
    await exec('hdiutil', [
      'attach',
      installer,
      '-mountpoint',
      mount,
      '-nobrowse',
      '-readonly',
    ]);
    try {
      const name = (await readdir(mount)).find((name) => name.endsWith('.app'));
      assert(name);
      appPath = path.join(evidence, 'Installed application 演示', name);
      await mkdir(path.dirname(appPath));
      await exec('ditto', [path.join(mount, name), appPath]);
    } finally {
      await exec('hdiutil', ['detach', mount]);
    }
    binary = path.join(appPath, 'Contents/MacOS/depthplan');
    const plist = JSON.parse(
      (
        await exec('plutil', [
          '-convert',
          'json',
          '-o',
          '-',
          path.join(appPath, 'Contents/Info.plist'),
        ])
      ).stdout,
    );
    for (const extension of ['depthplan', 'depthproject'])
      assert(
        plist.CFBundleDocumentTypes.some((type) =>
          type.CFBundleTypeExtensions?.includes(extension),
        ),
      );
    const projectType = plist.CFBundleDocumentTypes.find((type) =>
      type.CFBundleTypeExtensions?.includes('depthproject'),
    );
    assert.equal(projectType.CFBundleTypeIconFile, 'project.icns');
    assert.notEqual(
      await hash(path.join(appPath, 'Contents/Resources/project.icns')),
      await hash(path.join(appPath, 'Contents/Resources/icon.icns')),
    );
    await exec(
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      ['-f', appPath],
    );
    report.registration = plist.CFBundleDocumentTypes;
  } else if (process.platform === 'win32') {
    appPath = path.join(evidence, 'Installed application 演示');
    await ps('install', installer, appPath);
    binary = path.join(appPath, 'depthplan.exe');
    report.registration = {};
    for (const extension of ['depthplan', 'depthproject']) {
      const registration = JSON.parse(await ps('association', extension));
      assert.equal(registration.command, `"${binary}" "%1"`);
      if (extension === 'depthproject')
        assert.equal(
          registration.icon,
          `"${path.join(appPath, 'project.ico')}",0`,
        );
      report.registration[extension] = registration;
    }
    await access(path.join(appPath, 'project.ico'));
  } else {
    await exec('sudo', ['apt-get', 'install', '-y', installer]);
    binary = '/usr/bin/depthplan';
    wm = spawn('openbox', [], { stdio: 'ignore' });
    const entries = await readdir('/usr/share/applications');
    const matches = [];
    for (const entry of entries.filter((entry) => entry.endsWith('.desktop'))) {
      const text = await readFile(
        path.join('/usr/share/applications', entry),
        'utf8',
      );
      if (/^Exec=.*\bdepthplan\b/m.test(text)) matches.push({ entry, text });
    }
    assert.equal(matches.length, 1);
    report.registration = matches[0];
    assert.match(matches[0].text, /^Exec=depthplan %F$/m);
    await exec('desktop-file-validate', [
      path.join('/usr/share/applications', matches[0].entry),
    ]);
    await exec('update-desktop-database', [
      path.join(os.homedir(), '.local/share/applications'),
    ]).catch(() => {});
    await exec('sudo', ['update-mime-database', '/usr/share/mime']);
    for (const type of [
      'application/x-depthplan',
      'application/x-depthproject',
    ]) {
      assert(matches[0].text.includes(type));
      await exec('xdg-mime', ['default', matches[0].entry, type]);
      assert.equal(
        (await exec('xdg-mime', ['query', 'default', type])).stdout.trim(),
        matches[0].entry,
      );
    }
    assert.notEqual(
      await hash(
        '/usr/share/icons/hicolor/512x512/mimetypes/application-x-depthplan.png',
      ),
      await hash(
        '/usr/share/icons/hicolor/512x512/mimetypes/application-x-depthproject.png',
      ),
    );
  }
  report.binaryHash = await hash(binary);
  const adapter = path.join(
    path.dirname(binary),
    process.platform === 'win32' ? 'depthplan-mcp.exe' : 'depthplan-mcp',
  );
  const probe = client(adapter, path.join(evidence, 'missing-descriptor.json'));
  try {
    await probe.initialize();
    assert.equal(
      (await probe.call('depthplan_get_context')).error.code,
      'APP_UNAVAILABLE',
    );
    report.phases.push(
      'Installed MCP adapter discovers tools without a global Node runtime',
    );
  } finally {
    probe.close();
  }
  assert.equal((await processes()).length, 0);
  const doc = JSON.parse(
    await readFile('docs/sample/recursive_document.depthplan', 'utf8'),
  );
  const standalone = path.join(work, 'Standalone 演示.depthplan');
  doc.metadata.title = 'Installed standalone 演示';
  await writeFile(standalone, JSON.stringify(doc));
  const fixtures = [standalone];
  for (const name of ['First', 'Second']) {
    const root = path.join(work, `${name} project 演示`);
    await mkdir(root);
    const board = {
      ...doc,
      id: `${name}-board`,
      metadata: { ...doc.metadata, title: `${name} installed board` },
    };
    const boardPath = path.join(root, 'Board.depthplan');
    const manifest = path.join(root, `${name}.depthproject`);
    await writeFile(boardPath, JSON.stringify(board));
    await writeFile(
      manifest,
      JSON.stringify({
        projectVersion: 1,
        id: `${name}-project`,
        name: `${name} installed project`,
        description: '',
        homeBoardId: board.id,
        autosave: false,
        boards: [
          { id: board.id, name: board.metadata.title, path: 'Board.depthplan' },
        ],
      }),
    );
    fixtures.push(boardPath, manifest);
  }
  const originals = await Promise.all(fixtures.map(hash));
  const acknowledged = async (name) => {
    try {
      const entries = JSON.parse(await readFile(workspaceFile, 'utf8'));
      return entries.some(
        (entry) =>
          entry.id === `${name}-project` &&
          entry.view?.active === `${name}-board` &&
          entry.view.tabs.length === 1,
      );
    } catch {
      return false;
    }
  };
  const firstPid = await launch(fixtures[2]);
  await until(
    () => acknowledged('First'),
    'Renderer did not acknowledge cold project association',
  );
  await capture('cold-project', 'First installed project');
  report.phases.push('Cold .depthproject association accepted by renderer');
  assert.equal(
    await launch(fixtures[4]),
    firstPid,
    'Warm open must reuse the process',
  );
  await until(
    () => acknowledged('Second'),
    'Renderer did not acknowledge warm project association',
  );
  await capture('warm-project', 'Second installed project');
  report.phases.push(
    'Warm .depthproject association accepted by the same process',
  );
  assert.equal(await launch(standalone), firstPid);
  await capture('warm-standalone', 'Installed standalone');
  await quit();
  report.phases.push('Warm .depthplan association and native clean close');
  await launch(standalone);
  await capture('cold-standalone', 'Installed standalone');
  await quit();
  report.phases.push('Cold .depthplan association and native clean close');
  assert.deepEqual(await Promise.all(fixtures.map(hash)), originals);
  await cp(workspaceFile, path.join(evidence, 'workspaces.json'));
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  wm?.kill();
  await writeFile(
    path.join(evidence, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(`Installed artifact evidence: ${evidence}`);
}
console.log(
  `PASS ordinary installed ${process.platform} associations and lifecycle; review retained screenshots.`,
);
