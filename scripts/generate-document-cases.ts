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
record('null', null);
record('array', []);
writeFileSync('src-tauri/generated/document-cases.json', JSON.stringify(cases));
console.log(
  `Generated ${cases.length} document validation cases (${cases.filter((c) => c.valid).length} valid).`,
);
