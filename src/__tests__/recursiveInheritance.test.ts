import { recursiveFixture, geometry } from './recursiveFixtures';
import { selectRootDepth } from '../shared/recursiveLayouts';
import {
  editActiveGeometry,
  transactDocument,
  type DocumentEdit,
} from '../shared/documentTransactions';
import { type RecursiveDocument } from '../shared/recursiveDocument';
const apply = (d: RecursiveDocument, edit: DocumentEdit) => {
  const result = transactDocument(d, edit);
  if (result.status === 'rejected') throw new Error(result.error);
  return result.document;
};

it('skips directly to deepest using closest lower common geometry and seeds', () => {
  const d = recursiveFixture();
  delete d.layouts.app[2];
  const before = JSON.stringify(d);
  const next = apply(d, selectRootDepth('app', 'all'));
  expect(next.layouts.app[2]).toEqual({
    ...d.layouts.app[1],
    endpoint: geometry,
  });
  expect(next.objects).toEqual(d.objects);
  expect(next.layouts.payments).toEqual(d.layouts.payments);
  expect(next.rootDepths.payments).toBe(0);
  expect(JSON.stringify(d)).toBe(before);
});

it('uses nearest saved geometry for newly revealed objects, with lower ties and hidden entries retained', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 0;
  delete d.layouts.app[1];
  d.layouts.app[0].endpoint = { ...geometry, x: 333 };
  d.layouts.app[4] = { ...d.layouts.app[2], api: { ...geometry, x: 444 } };
  const next = apply(d, selectRootDepth('app', 1));
  expect(next.layouts.app[1].app).toEqual(d.layouts.app[0].app);
  expect(next.layouts.app[1].api).toEqual(d.layouts.app[2].api);
  expect(next.layouts.app[1].endpoint.x).toBe(333);
  const tie = recursiveFixture();
  tie.rootDepths.app = 0;
  tie.layouts.app[0].api = { ...geometry, x: 111 };
  delete tie.layouts.app[1];
  expect(apply(tie, selectRootDepth('app', 1)).layouts.app[1].api.x).toBe(111);
});

it('edits and resizes a first-use arrangement without altering seeds or revisits', () => {
  let d = recursiveFixture();
  delete d.layouts.app[2];
  d = apply(d, selectRootDepth('app', 2));
  d = apply(
    d,
    editActiveGeometry('endpoint', { x: -123, width: 345, height: 98 }),
  );
  const layouts = JSON.stringify(d.layouts);
  d = apply(apply(d, selectRootDepth('app', 0)), selectRootDepth('app', 2));
  expect(JSON.stringify(d.layouts)).toBe(layouts);
  expect(d.objects.endpoint.geometry).toEqual(geometry);
  expect(transactDocument(d, selectRootDepth('app', 2)).status).toBe('noop');
});

it('rejects fractional and unknown targets without adding arrangements', () => {
  const d = recursiveFixture();
  for (const edit of [
    selectRootDepth('missing', 1),
    selectRootDepth('app', 1.5),
  ]) {
    const result = transactDocument(d, edit);
    expect(result.status).toBe('rejected');
    expect(result.document).toBe(d);
  }
});
