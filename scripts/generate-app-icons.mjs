import { run } from '@tauri-apps/cli';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artwork = path.join(root, 'src/renderer/assets');
const logo = readFileSync(path.join(artwork, 'depthplan_logo.svg'), 'utf8');
const viewBox = logo.match(/\bviewBox="([^"]+)"/)[1];
const shapes = logo
  .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');
const appIcon = path.join(artwork, 'depthplan_app_icon.svg');
writeFileSync(
  appIcon,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>DepthPlan app icon</title>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#ffffff" />
  <svg x="96" y="72" width="832" height="832" viewBox="${viewBox}">${shapes}</svg>
</svg>
`,
);
const output = mkdtempSync(path.join(tmpdir(), 'depthplan-icons-'));
try {
  await run(['icon', appIcon, '--output', output]);
  for (const name of ['icon.png', 'icon.icns', 'icon.ico'])
    copyFileSync(path.join(output, name), path.join(root, 'assets', name));
} finally {
  rmSync(output, { recursive: true, force: true });
}
