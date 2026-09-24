const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const renderer = JSON.parse(
  fs.readFileSync('out/tauri-renderer/THIRD-PARTY-LICENSES.json', 'utf8'),
);
for (const name of [
  'react',
  'react-dom',
  'konva',
  'react-konva',
  '@tauri-apps/api',
])
  assert(
    renderer.some((e) => e.name === name),
    `Missing ${name} notice`,
  );
for (const entry of renderer)
  assert(
    entry.text?.trim(),
    `Missing license text: ${entry.name}@${entry.version}`,
  );
fs.mkdirSync('src-tauri/generated', { recursive: true });
execFileSync(
  'cargo',
  [
    'about',
    'generate',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--fail',
    '--format',
    'json',
    '--output-file',
    'src-tauri/generated/RUST-LICENSES.json',
  ],
  { stdio: 'inherit' },
);
const native = JSON.parse(
  fs.readFileSync('src-tauri/generated/RUST-LICENSES.json', 'utf8'),
);
assert(native.licenses.length > 0, 'Missing Rust license inventory');
for (const entry of native.licenses)
  assert(entry.text?.trim(), 'Missing Rust license text');
// Retain notices and package attribution without embedding local build paths.
fs.writeFileSync(
  'src-tauri/generated/RUST-LICENSES.json',
  JSON.stringify(
    native.licenses.map(({ id, name, text, used_by }) => ({
      id,
      name,
      text,
      packages: used_by.map(({ crate: pkg }) => ({
        name: pkg.name,
        version: pkg.version,
        authors: pkg.authors,
        repository: pkg.repository,
        license: pkg.license,
      })),
    })),
    null,
    2,
  ),
);
console.log(
  `License texts verified: ${renderer.length} JavaScript dependencies and ${native.licenses.length} Rust license entries.`,
);
