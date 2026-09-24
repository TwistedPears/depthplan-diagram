import { build } from 'esbuild';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  unlink,
  lstat,
  realpath,
} from 'node:fs/promises';
import { platform, arch, release } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('../', import.meta.url));
export const runsDirectory = join(repo, 'out/stress-runs');
const kind = 'DepthPlan stress run';
const artifact = 'document.depthplan';
async function generator() {
  const compiled = await build({
    stdin: {
      contents:
        'export * from "./src/shared/stressDocument"; export { validateRecursiveDocument } from "./src/shared/recursiveDocument";',
      resolveDir: repo,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].contents).toString('base64')
  );
}
export async function cleanStressRun(runId) {
  // No arbitrary paths or recursive deletion. Ownership survives successful cleanup.
  if (!/^run-[A-Za-z0-9]+$/.test(runId))
    throw new Error('Expected an owned run ID, not a path.');
  const directory = join(runsDirectory, runId);
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== join(await realpath(runsDirectory), runId)
  )
    throw new Error('Cleanup refuses redirected run directories.');
  const reportPath = join(directory, 'run.json');
  if ((await lstat(reportPath)).isSymbolicLink())
    throw new Error('Cleanup refuses redirected ownership records.');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (report.kind !== kind || report.runId !== runId)
    throw new Error('Run ownership does not match.');
  // Unlink removes only this directory entry, never a symlink target.
  await unlink(join(directory, artifact)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
export async function runStress(requested, command) {
  await mkdir(runsDirectory, { recursive: true });
  const directory = await mkdtemp(join(runsDirectory, 'run-'));
  const runId = basename(directory);
  const {
    stressGeneratorVersion,
    generateStressDocument,
    validateRecursiveDocument,
  } = await generator();
  const record = {
    kind,
    runId,
    generatorVersion: stressGeneratorVersion,
    requested,
    host: {
      platform: platform(),
      arch: arch(),
      release: release(),
      node: process.version,
    },
    command,
    started: new Date().toISOString(),
    cleanup: `npm run stress -- --cleanup ${runId}`,
  };
  await writeFile(
    join(directory, 'run.json'),
    JSON.stringify(record, null, 2) + '\n',
    { flag: 'wx' },
  );
  const started = performance.now();
  let result;
  try {
    const generated = generateStressDocument(requested);
    const bytes = JSON.stringify(generated.document) + '\n';
    await writeFile(join(directory, artifact), bytes, { flag: 'wx' });
    // Re-parse and validate bytes from disk, not only the in-memory object.
    validateRecursiveDocument(
      JSON.parse(await readFile(join(directory, artifact), 'utf8')),
    );
    await cleanStressRun(runId);
    result = {
      status: 'passed',
      settings: generated.settings,
      counts: generated.counts,
      bytes: Buffer.byteLength(bytes),
      artifact: null,
    };
  } catch (error) {
    const retained = await lstat(join(directory, artifact)).then(
      () => join(directory, artifact),
      () => null,
    );
    result = {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      artifact: retained,
    };
  }
  result.elapsedMs = performance.now() - started;
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify(result, null, 2) + '\n',
    { flag: 'wx' },
  );
  return { ...record, ...result, directory };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        preset: { type: 'string', default: 'small' },
        seed: { type: 'string', default: 'depthplan-stress-v1' },
        settings: { type: 'string' },
        presets: { type: 'boolean' },
        cleanup: { type: 'string' },
      },
    });
    if (values.cleanup) {
      await cleanStressRun(values.cleanup);
      console.log(
        `Cleaned generated document for ${values.cleanup}; reports retained.`,
      );
    } else {
      const { stressPresets } = await generator();
      if (values.presets) console.log(JSON.stringify(stressPresets, null, 2));
      else {
        if (!Object.hasOwn(stressPresets, values.preset))
          throw new Error(`Unknown preset: ${values.preset}`);
        const overrides = values.settings ? JSON.parse(values.settings) : {};
        if (
          !overrides ||
          typeof overrides !== 'object' ||
          Array.isArray(overrides)
        )
          throw new Error('Settings must be a JSON object.');
        const result = await runStress(
          { ...stressPresets[values.preset], ...overrides, seed: values.seed },
          process.argv,
        );
        console.log(JSON.stringify(result, null, 2));
        if (result.status !== 'passed') process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
