import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { validateRecursiveDocument } from '../src/shared/recursiveDocument';
import { recursiveFixture } from '../src/__tests__/recursiveFixtures';
const cases: { name: string; document: unknown; valid: boolean }[] = [];
function record(name: string, document: unknown) {
  let valid = true;
  try {
    validateRecursiveDocument(document);
  } catch {
    valid = false;
  }
  cases.push({ name, document, valid });
}
const base = recursiveFixture() as any;
base.objects.app.content = [
  {
    type: 'heading',
    level: 2,
    runs: [
      { text: 'hello', marks: { bold: true, link: 'https://example.com' } },
    ],
  },
];
base.connections.edge = {
  id: 'edge',
  ownerId: null,
  kind: 'arrow',
  z: 0,
  start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
  end: { kind: 'free', x: 100, y: 100 },
  depthRoutes: {
    1: {
      points: [{ x: 1, y: 2 }],
      start: { kind: 'object', objectId: 'app', side: 'top', offset: 0.25 },
      end: { kind: 'free', x: 5, y: 5 },
    },
  },
};
base.namedViews = {
  overview: {
    id: 'overview',
    name: 'Overview',
    rootDepths: { app: 1 },
    camera: { x: 0, y: 0, scale: 1 },
    layouts: {
      app: { app: { x: 0, y: 0, width: 100, height: 100, parentId: null } },
    },
  },
};
record('complete recursive', base);
record('unsupported unversioned document', {
  metadata: { title: 'Unsupported' },
  canvas: {
    width: 100,
    height: 100,
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
  },
  blocks: {},
  connections: {},
});
for (const name of readdirSync('docs/sample').filter(
  (n) => n.endsWith('.depthplan') || n.endsWith('.depthplan.json'),
))
  record(name, JSON.parse(readFileSync('docs/sample/' + name, 'utf8')));
function mutate(name: string, fn: (v: any) => void, source = base) {
  const value = structuredClone(source);
  fn(value);
  record(name, value);
}
// Mutation corpus compares native acceptance with the existing editor contract.
for (const location of [
  'formatVersion',
  'id',
  'metadata',
  'metadata.title',
  'objects',
  'objects.app',
  'objects.app.id',
  'objects.app.parentId',
  'objects.app.type',
  'objects.app.name',
  'objects.app.geometry',
  'objects.app.geometry.rotation',
  'objects.app.geometry.width',
  'objects.app.geometry.z',
  'objects.app.content',
  'objects.app.content.0.level',
  'objects.app.content.0.runs',
  'objects.app.content.0.runs.0.marks',
  'objects.api.parentId',
  'rootDepths',
  'rootDepths.app',
  'layouts',
  'layouts.app',
  'layouts.app.0',
  'layouts.app.1.api',
  'connections.edge.ownerId',
  'connections.edge.kind',
  'connections.edge.start.objectId',
  'connections.edge.start.offset',
  'connections.edge.end.x',
  'connections.edge.depthRoutes',
  'connections.edge.depthRoutes.1',
  'connections.edge.depthRoutes.1.points',
  'connections.edge.depthRoutes.1.points.0.x',
  'connections.edge.depthRoutes.1.start',
  'connections.edge.depthRoutes.1.start.objectId',
  'connections.edge.depthRoutes.1.start.offset',
  'connections.edge.depthRoutes.1.end',
  'namedViews.overview.layouts.app.app.parentId',
  'namedViews.overview.camera.scale',
]) {
  for (const value of [null, 'bad', -1, 0, 1.5, 360, {}, []])
    mutate(location + '=' + JSON.stringify(value), (v) => {
      const keys = location.split('.');
      let p = v;
      for (const k of keys.slice(0, -1)) p = p[k];
      p[keys.at(-1)!] = value;
    });
  mutate('missing ' + location, (v) => {
    const keys = location.split('.');
    let p = v;
    for (const k of keys.slice(0, -1)) p = p[k];
    delete p[keys.at(-1)!];
  });
}
mutate('cycle', (v) => {
  v.objects.app.parentId = 'endpoint';
});
mutate('extension preservation', (v) => {
  v.extensions = { future: { array: [1, null, false], unknown: 'keep' } };
});
mutate('unknown code', (v) => {
  v.objects.app.content = [
    { type: 'code', text: 'x', language: 'future-language' },
  ];
});
mutate('language code', (v) => {
  v.objects.app.content = [{ type: 'code', text: 'x', language: 'csharp' }];
});
mutate('empty quote', (v) => {
  v.objects.app.content = [{ type: 'quote', blocks: [] }];
});
mutate('nested list', (v) => {
  v.objects.app.content = [
    { type: 'list', ordered: true, items: [[{ type: 'paragraph', runs: [] }]] },
  ];
});
mutate('bad endpoint ownership', (v) => {
  v.connections.edge.ownerId = 'payments';
});
mutate('repair', (v) => {
  v.connectionRepairs = {
    edge: {
      connection: v.connections.edge,
      ownerGeometry: null,
      start: { x: 0, y: 0 },
      end: { x: 2, y: 2 },
      reason: 'missing',
    },
  };
  delete v.connections.edge;
});
mutate('missing repair geometry', (v) => {
  v.connectionRepairs = {
    repair: {
      connection: { ...v.connections.edge, id: 'repair' },
      start: { x: 0, y: 0 },
      end: { x: 2, y: 2 },
      reason: 'missing',
    },
  };
});
const tagged = structuredClone(base);
tagged.tagDefinitions = {
  confirm: { id: 'confirm', name: 'To confirm', color: '#d97706' },
  planned: {
    id: 'planned',
    name: 'Planned',
    color: '#2563eb',
    strokeStyle: 'dashed',
  },
};
tagged.objects.app.tags = ['confirm', 'planned'];
tagged.connections.edge.tags = ['planned'];
record('tags', tagged);
// Unknown tag IDs are ignored rather than rejected, so pasted or hand-edited files load.
mutate(
  'dangling tag reference',
  (v) => {
    v.objects.api.tags = ['missing'];
    v.connections.edge.tags = ['missing', 'confirm'];
  },
  tagged,
);
for (const location of [
  'tagDefinitions',
  'tagDefinitions.confirm',
  'tagDefinitions.confirm.id',
  'tagDefinitions.confirm.name',
  'tagDefinitions.confirm.color',
  'tagDefinitions.planned.strokeStyle',
  'objects.app.tags',
  'objects.app.tags.0',
  'connections.edge.tags',
]) {
  for (const value of [null, 'bad', '', ' ', 'dotted', 1, {}, [], ['ok']])
    mutate(
      location + '=' + JSON.stringify(value),
      (v) => {
        const keys = location.split('.');
        let p = v;
        for (const k of keys.slice(0, -1)) p = p[k];
        p[keys.at(-1)!] = value;
      },
      tagged,
    );
  mutate(
    'missing ' + location,
    (v) => {
      const keys = location.split('.');
      let p = v;
      for (const k of keys.slice(0, -1)) p = p[k];
      delete p[keys.at(-1)!];
    },
    tagged,
  );
}
mutate(
  'repair connection tags',
  (v) => {
    v.connectionRepairs = {
      gone: {
        connection: { ...v.connections.edge, id: 'gone', tags: 'planned' },
        ownerGeometry: null,
        start: { x: 0, y: 0 },
        end: { x: 2, y: 2 },
        reason: 'missing',
      },
    };
  },
  tagged,
);
mutate(
  'tag key mismatch and reserved key',
  (v) => {
    v.tagDefinitions.other = { ...v.tagDefinitions.confirm };
    v.objects.app.tags = ['__proto__'];
  },
  tagged,
);
for (const key of ['0', '01', '-1', 'x', '1.5', '9007199254740992'])
  mutate(`depth route key ${key}`, (v) => {
    v.connections.edge.depthRoutes = { [key]: { points: [] } };
  });
const depthRoute = (name: string, route: unknown, fn?: (v: any) => void) =>
  mutate(`depth route ${name}`, (v) => {
    fn?.(v);
    v.connections.edge.depthRoutes = { 1: route };
  });
depthRoute('empty', {});
depthRoute('unknown only', { future: true });
depthRoute('free start for bound shared', {
  start: { kind: 'free', x: 0, y: 0 },
});
depthRoute('bound end for free shared', {
  end: { kind: 'object', objectId: 'app', side: 'top', offset: 0 },
});
depthRoute('other target', {
  start: { kind: 'object', objectId: 'payments', side: 'top', offset: 0 },
});
depthRoute('missing boundary', {
  start: { kind: 'boundary', objectId: 'app', pointId: 'port' },
});
depthRoute(
  'boundary',
  { start: { kind: 'boundary', objectId: 'app', pointId: 'port' } },
  (v) => {
    v.objects.app.boundaryPoints = { port: { side: 'left', offset: 0.5 } };
  },
);
depthRoute('free-free', { points: [] }, (v) => {
  v.connections.edge.start = { kind: 'free', x: 0, y: 0 };
});
depthRoute('cross-root', { points: [] }, (v) => {
  v.connections.edge.end = {
    kind: 'object',
    objectId: 'payments',
    side: 'left',
    offset: 0.5,
  };
});
depthRoute('owned', { start: { kind: 'free', x: 0, y: 0 } }, (v) => {
  v.connections.edge.ownerId = 'app';
  v.connections.edge.start = { kind: 'free', x: 3, y: 3 };
});
record('null', null);
record('array', []);

for (const link of [
  { projectId: 'project', boardId: 'board' },
  { projectId: 'project', boardId: 'board', bookmarkId: 'bookmark 演示' },
  { projectId: 'project', boardId: 'board', bookmarkId: '😀'.repeat(128) },
  null,
  'file:///tmp/board',
  {},
  { projectId: 'project', boardId: '../board' },
  { projectId: 'constructor', boardId: 'board' },
  { projectId: 'project', boardId: 'board', bookmarkId: '__proto__' },
  { projectId: 'project', boardId: 'board', bookmarkId: null },
  { projectId: 'project', boardId: 'board', bookmarkId: '😀'.repeat(129) },
  { projectId: 'project', boardId: 'board', path: '/tmp/board' },
])
  mutate(`project link ${JSON.stringify(link)}`, (v) => {
    v.objects.app.projectLink = link;
  });

writeFileSync('src-tauri/generated/document-cases.json', JSON.stringify(cases));
console.log(
  `Generated ${cases.length} document validation cases (${cases.filter((c) => c.valid).length} valid).`,
);
