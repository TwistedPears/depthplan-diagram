import { searchObjects } from '../shared/objectSearch';
import { revealObject, setChildrenExpanded } from '../shared/recursiveLayouts';
import { recursiveVisibility } from '../shared/recursiveVisibility';
import { recursiveScene } from '../shared/recursiveScene';
import { transactDocument } from '../shared/documentTransactions';
import { recursiveFixture } from './recursiveFixtures';

it('matches every literal query term across names and rich text, including hidden objects', () => {
  const document = recursiveFixture();
  document.objects.endpoint.name = 'Payment API';
  document.objects.endpoint.content = [
    { type: 'paragraph', runs: [{ text: 'Cust' }, { text: 'omer' }] },
    {
      type: 'quote',
      blocks: [{ type: 'heading', level: 2, runs: [{ text: 'Orders' }] }],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            type: 'code',
            text: 'fetch(id)',
            language: 'javascript',
            wrap: true,
          },
        ],
      ],
    },
  ];
  expect(recursiveVisibility(document).visible.has('endpoint')).toBe(false);
  expect(
    searchObjects(document, ' API  customer\norders fetch(id) ').map(
      ({ id }) => id,
    ),
  ).toEqual(['endpoint']);
  expect(searchObjects(document, 'api missing')).toEqual([]);
  expect(searchObjects(document, '.*')).toEqual([]);
  expect(searchObjects(document, ' \n ')).toEqual([]);
  expect(searchObjects(document, 'app').map(({ id }) => id)).toEqual(['app']);
});

it('returns each matching object once and reflects edits and deletions', () => {
  const document = recursiveFixture();
  document.objects.api.content = [
    { type: 'paragraph', runs: [{ text: 'app app' }] },
  ];
  expect(searchObjects(document, 'app').map(({ id }) => id)).toEqual([
    'app',
    'api',
  ]);
  delete document.objects.api;
  expect(searchObjects(document, 'app').map(({ id }) => id)).toEqual(['app']);
});

it('reveals and fits the ancestor path in one transaction while preserving distant roots', () => {
  let document = recursiveFixture();
  document = transactDocument(
    document,
    setChildrenExpanded('app', false),
  ).document;
  const before = recursiveScene(document);
  const result = transactDocument(document, revealObject('endpoint'));
  expect(result.status).toBe('accepted');
  const after = recursiveScene(result.document);
  expect(after.world.has('endpoint')).toBe(true);
  expect(after.world.get('app')).toMatchObject({
    x: before.world.get('app')!.x,
    y: before.world.get('app')!.y,
  });
  expect(after.world.get('app')!.width).toBeGreaterThan(
    before.world.get('app')!.width,
  );
  expect(result.document.rootDepths.payments).toBe(
    document.rootDepths.payments,
  );
  expect(result.document.layouts.payments).toEqual(document.layouts.payments);
  expect(recursiveScene(document).world.has('endpoint')).toBe(false);
  expect(
    transactDocument(result.document, revealObject('endpoint')).status,
  ).toBe('noop');
  expect(
    transactDocument(result.document, revealObject('missing')).status,
  ).toBe('rejected');
});
