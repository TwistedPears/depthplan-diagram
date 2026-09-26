import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const bundled = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { projectManifestSchema } from './src/shared/projectContract';
writeFileSync('src-tauri/generated/project-schema.json', JSON.stringify(z.toJSONSchema(projectManifestSchema)));
import { mcpTools } from './src/shared/mcpRegistry';
console.log(JSON.stringify(Object.entries(mcpTools).map(([name, tool]) => ({
  name,
  description: 'description' in tool ? tool.description : 'Inspect live DepthPlan roots or change a root’s displayed depth.',
  inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
  outputSchema: z.toJSONSchema(tool.output),
  annotations: { readOnlyHint: tool.readOnly, destructiveHint: 'destructive' in tool && tool.destructive, openWorldHint: false },
})), null, 2));`,
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
});
await mkdir('src-tauri/generated', { recursive: true });
const result = spawnSync(process.execPath, ['-'], {
  input: bundled.outputFiles[0].text,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr);
await writeFile('src-tauri/generated/mcp-tools.json', result.stdout);
console.log(
  `Generated ${JSON.parse(result.stdout).length} native MCP tool schemas.`,
);
const fixtures = await build({
  entryPoints: ['scripts/generate-document-cases.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
});
const generated = spawnSync(process.execPath, ['-'], {
  input: fixtures.outputFiles[0].text,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (generated.error) throw generated.error;
if (generated.status !== 0)
  throw new Error('Could not generate document conformance cases');
