import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

assert.equal(process.platform, 'linux', 'Build Flatpak on a native Linux host');
const architectures = { x64: ['x86_64', 'amd64'], arm64: ['aarch64', 'arm64'] };
assert(architectures[process.arch], 'Supported Linux CPUs: x86_64 and ARM64');
const [arch, debArch] = architectures[process.arch];
const run = (command, args) =>
  execFileSync(command, args, { stdio: 'inherit' });
const manifestPath = 'flatpak/com.twistedpears.depthplan.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
assert.match(version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const bundle = path.join(
  process.env.CARGO_TARGET_DIR || 'src-tauri/target',
  'release/bundle',
);
const debs = readdirSync(path.join(bundle, 'deb')).filter((name) =>
  name.endsWith('.deb'),
);
assert.equal(debs.length, 1, 'Expected one freshly built Debian package');
const deb = path.join(bundle, 'deb', debs[0]);
assert.equal(
  execFileSync('dpkg-deb', ['--field', deb, 'Version'], {
    encoding: 'utf8',
  }).trim(),
  version,
  'Rebuild the Debian package after changing the application version',
);
assert.equal(
  execFileSync('dpkg-deb', ['--field', deb, 'Architecture'], {
    encoding: 'utf8',
  }).trim(),
  debArch,
  'The Debian package must match the native Flatpak architecture',
);
const source = '.tmp/flatpak-source';
rmSync(source, { recursive: true, force: true });
mkdirSync(source, { recursive: true });
run('dpkg-deb', ['--extract', deb, source]);
// Reuse Tauri's complete native package, including the MCP adapter and licenses.
for (const name of ['depthplan', 'depthplan-mcp']) {
  const elf = readFileSync(path.join(source, 'usr/bin', name));
  assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
  assert.equal(elf[4], 2, 'Expected a 64-bit ELF binary');
  assert.equal(elf[5], 1, 'Expected a little-endian ELF binary');
  assert.equal(elf.readUInt16LE(18), arch === 'x86_64' ? 62 : 183);
}
const remote = 'https://dl.flathub.org/repo/flathub.flatpakrepo';
run('flatpak', ['remote-add', '--user', '--if-not-exists', 'flathub', remote]);
run('flatpak', [
  'install',
  '--user',
  '--noninteractive',
  'flathub',
  `${manifest.runtime}//${manifest['runtime-version']}`,
  `${manifest.sdk}//${manifest['runtime-version']}`,
  'org.flatpak.Builder',
]);
run('flatpak', [
  'run',
  // The builder must see the host user's runtime installation, not its own app data.
  `--env=FLATPAK_USER_DIR=${process.env.FLATPAK_USER_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'flatpak')}`,
  '--command=flatpak-builder',
  'org.flatpak.Builder',
  '--user',
  '--force-clean',
  '--disable-rofiles-fuse',
  `--arch=${arch}`,
  '--state-dir=.tmp/flatpak-state',
  '--repo=.tmp/flatpak-repo',
  '.tmp/flatpak-build',
  manifestPath,
]);
mkdirSync(path.join(bundle, 'flatpak'), { recursive: true });
run('flatpak', [
  'build-bundle',
  `--arch=${arch}`,
  `--runtime-repo=${remote}`,
  '.tmp/flatpak-repo',
  path.join(bundle, 'flatpak', `DepthPlan-${version}-${arch}.flatpak`),
  manifest['app-id'],
  manifest['default-branch'],
]);
