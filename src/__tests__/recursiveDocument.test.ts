import {
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import { recursiveFixture, geometry } from './recursiveFixtures';
it('validates all hidden objects, inactive geometry, rich structure and boundary references', () => {
  const d = recursiveFixture();
  d.objects.api.content = [
    {
      type: 'heading',
      level: 2,
      align: 'center',
      runs: [
        { text: 'Hello ', marks: { bold: true } },
        {
          text: 'world',
          marks: { color: '#f00', link: 'https://example.com' },
        },
      ],
    },
    {
      type: 'list',
      ordered: true,
      start: 3,
      items: [
        [
          {
            type: 'quote',
            blocks: [{ type: 'paragraph', runs: [{ text: 'nested' }] }],
          },
        ],
      ],
    },
    { type: 'code', text: '\tconst x = "<x>";\r\n', language: 'typescript' },
  ];
  d.objects.app.boundaryPoints = { in: { side: 'left', offset: 0.5 } };
  d.connections.bridge = {
    id: 'bridge',
    ownerId: 'app',
    kind: 'arrow',
    z: 0,
    start: { kind: 'boundary', objectId: 'app', pointId: 'in' },
    end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
  };
  d.extensions = { vendor: { values: [null, true, 1, 'retained'] } };
  const encoded = JSON.stringify(d);
  validateRecursiveDocument(d);
  expect(JSON.stringify(d)).toBe(encoded);
  validateRecursiveDocument(JSON.parse(encoded));
});
it.each([
  [
    'version',
    (d: RecursiveDocument) => {
      (d as { formatVersion: number }).formatVersion = 3;
    },
  ],
  [
    'cycle',
    (d: RecursiveDocument) => {
      d.objects.app.parentId = 'endpoint';
    },
  ],
  [
    'missing parent',
    (d: RecursiveDocument) => {
      d.objects.api.parentId = 'missing';
    },
  ],
  [
    'hidden geometry',
    (d: RecursiveDocument) => {
      d.objects.endpoint.geometry.x = Infinity;
    },
  ],
  [
    'dimensions',
    (d: RecursiveDocument) => {
      d.layouts.app[2].endpoint.width = 0;
    },
  ],
  [
    'foreign layout',
    (d: RecursiveDocument) => {
      d.layouts.app[1].payments = { ...geometry };
    },
  ],
  [
    'missing layout',
    (d: RecursiveDocument) => {
      delete d.layouts.app[1].api;
    },
  ],
  [
    'depth',
    (d: RecursiveDocument) => {
      d.rootDepths.app = 3;
    },
  ],
  [
    'unsafe link',
    (d: RecursiveDocument) => {
      d.objects.api.content = [
        {
          type: 'paragraph',
          runs: [{ text: 'click', marks: { link: 'javascript:alert(1)' } }],
        },
      ];
    },
  ],
  [
    'content',
    (d: RecursiveDocument) => {
      d.objects.api.content = [{ type: 'heading', level: 8, runs: [] }];
    },
  ],
  [
    'point',
    (d: RecursiveDocument) => {
      d.connections.c = {
        id: 'c',
        ownerId: null,
        kind: 'line',
        z: 0,
        start: { kind: 'boundary', objectId: 'api', pointId: 'missing' },
        end: { kind: 'free', x: 0, y: 0 },
      };
    },
  ],
])('rejects invalid %s', (_name, mutate) => {
  const d = recursiveFixture();
  mutate(d);
  expect(() => validateRecursiveDocument(d)).toThrow();
});
it('permits shared in-memory records but rejects cycles and non-JSON extension values', () => {
  const d = recursiveFixture();
  d.objects.api.geometry = d.objects.app.geometry;
  validateRecursiveDocument(d);
  d.extensions = { bad: NaN };
  expect(() => validateRecursiveDocument(d)).toThrow();
  d.extensions = {};
  (d.extensions as Record<string, unknown>).cycle = d;
  expect(() => validateRecursiveDocument(d)).toThrow();
});
