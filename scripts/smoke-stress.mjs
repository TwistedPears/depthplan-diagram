import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  lstat,
  symlink,
  unlink,
  rmdir,
} from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  runStress,
  cleanStressRun,
  runsDirectory,
} from './generate-stress.mjs';
const passed = await runStress({ seed: 'cli-smoke' }, process.argv);
assert.equal(passed.status, 'passed');
assert.equal(passed.artifact, null);
await assert.rejects(lstat(join(passed.directory, 'document.depthplan')), {
  code: 'ENOENT',
});
assert.equal(
  JSON.parse(await readFile(join(passed.directory, 'result.json'), 'utf8'))
    .bytes,
  passed.bytes,
);
await cleanStressRun(passed.runId); // Repeat cleanup is harmless.
const failure = await runStress(
  { seed: 'reproduce-failure', roots: -1 },
  process.argv,
);
const repeat = await runStress(failure.requested, process.argv);
assert.equal(failure.status, 'failed');
assert.equal(repeat.error, failure.error);
assert.equal(failure.generatorVersion, repeat.generatorVersion);
assert.ok(failure.cleanup.includes(failure.runId));
await assert.rejects(cleanStressRun('../outside'), /run ID/);
await assert.rejects(cleanStressRun(passed.directory), /run ID/);
// A failed run may retain only its generated document. Cleanup preserves neighbors.
const generated = join(failure.directory, 'document.depthplan');
await writeFile(generated, 'retained failure fixture', { flag: 'wx' });
await assert.rejects(writeFile(generated, 'overwrite', { flag: 'wx' }), {
  code: 'EEXIST',
});
const neighbor = join(failure.directory, 'user-file');
await writeFile(neighbor, 'preserve', { flag: 'wx' });
await cleanStressRun(failure.runId);
assert.equal(await readFile(neighbor, 'utf8'), 'preserve');
await unlink(neighbor);
const unowned = await mkdtemp(join(runsDirectory, 'run-'));
await writeFile(join(unowned, 'run.json'), '{}', { flag: 'wx' });
await assert.rejects(cleanStressRun(basename(unowned)), /ownership/);
await unlink(join(unowned, 'run.json'));
await rmdir(unowned);
const redirected = await mkdtemp(join(runsDirectory, 'run-'));
await rmdir(redirected);
await symlink(passed.directory, redirected);
await assert.rejects(cleanStressRun(basename(redirected)), /redirected/);
await unlink(redirected);
console.log(
  JSON.stringify(
    {
      status: 'passed',
      success: passed.directory,
      failure: failure.directory,
      reproducibility: repeat.directory,
      checks:
        'generate/validate/clean, repeatable failure, exclusive files, bounded cleanup, ownership, symlinks',
    },
    null,
    2,
  ),
);
