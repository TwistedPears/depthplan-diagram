import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function projects({ native, dialogs, profile }) {
  const success = (result) => {
    assert.equal(result.status, 'success', JSON.stringify(result));
    return result.project;
  };
  assert.equal(
    (await native('project:inspect', '/forged/path')).status,
    'error',
  );
  await dialogs('folder', null);
  assert.equal(
    (await native('project:create', 'Canceled', 'canceled')).status,
    'canceled',
  );
  await dialogs('folder', profile);
  let project = success(
    await native('project:create', 'Portable project', 'portable-project'),
  );
  const first = project.manifest.boards[0];
  const firstBytes = await readFile(
    path.join(path.dirname(project.location), first.path),
  );
  await dialogs('project-open', project.location);
  assert.equal((await native('project:open')).status, 'error');
  const source = path.join(profile, 'project-source.depthplan.json');
  const sourceBytes = await readFile(
    'docs/sample/recursive_document.depthplan',
  );
  await writeFile(source, sourceBytes);
  const change = async (action) => {
    project = success(
      await native(
        'project:apply',
        project.sessionId,
        project.fingerprint,
        action,
      ),
    );
  };
  await dialogs('open', source);
  await change({
    kind: 'importBoard',
    name: 'Imported',
    path: 'Imported.depthplan',
  });
  assert.deepEqual(await readFile(source), sourceBytes);
  const imported = project.manifest.boards[1];
  const read = await native(
    'project:read-board',
    project.sessionId,
    imported.id,
  );
  assert.equal(read.status, 'success');
  assert.notEqual(read.board.document.id, JSON.parse(sourceBytes).id);
  assert.deepEqual(
    read.board.document.objects,
    JSON.parse(sourceBytes).objects,
  );
  await change({
    kind: 'duplicateBoard',
    boardId: imported.id,
    name: 'Copy',
    path: 'Copy.depthplan',
  });
  const copy = project.manifest.boards[2];
  await change({
    kind: 'renameBoard',
    boardId: imported.id,
    name: 'Renamed',
    path: 'Renamed.depthplan',
    expected: read.board.fingerprint,
  });
  await change({
    kind: 'reorderBoards',
    ids: [copy.id, imported.id, first.id],
  });
  await change({
    kind: 'settings',
    name: 'Saved project',
    description: 'Preserved',
    homeBoardId: imported.id,
    autosave: false,
  });
  await change({ kind: 'removeBoard', boardId: first.id });
  assert.deepEqual(
    await readFile(path.join(path.dirname(project.location), first.path)),
    firstBytes,
  );
  // Existing standalone save routes respect the project lock.
  await dialogs(
    'save',
    path.join(path.dirname(project.location), 'Copy.depthplan'),
  );
  assert.equal(
    (await native('file:save', read.board.document)).status,
    'error',
  );
  await native('project:close', project.sessionId);
  assert.equal(
    (await native('project:inspect', project.sessionId)).status,
    'error',
  );
  await dialogs('project-open', project.location);
  const reopened = success(await native('project:open'));
  assert.deepEqual(reopened.manifest, project.manifest);
  assert.equal(reopened.workspaceKey, project.workspaceKey);
  assert.notEqual(reopened.sessionId, project.sessionId);
  const external = await readFile(reopened.location);
  await writeFile(reopened.location, '{}');
  assert.equal(
    (
      await native('project:apply', reopened.sessionId, reopened.fingerprint, {
        kind: 'removeBoard',
        boardId: copy.id,
      })
    ).status,
    'error',
  );
  assert.equal(await readFile(reopened.location, 'utf8'), '{}');
  await writeFile(reopened.location, external);
  await native('project:close', reopened.sessionId);
}
