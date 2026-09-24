import {
  toggleSelection,
  marqueeSelection,
} from '../shared/recursiveSelection';
import { sceneBounds } from '../shared/recursiveCamera';
import { recursiveFixture } from './recursiveFixtures';
it('click replaces selection and modifiers toggle independent parent/child/connector targets', () => {
  let s = toggleSelection([], 'object-app', false);
  s = toggleSelection(s, 'object-api', true);
  s = toggleSelection(s, 'connection-app', true);
  expect(s).toEqual(['object-app', 'object-api', 'connection-app']);
  expect(toggleSelection(s, 'object-api', true)).toEqual([
    'object-app',
    'connection-app',
  ]);
  expect(toggleSelection(s, 'object-payments', false)).toEqual([
    'object-payments',
  ]);
});
it('directional marquee uses displayed bounds and includes frames alongside children', () => {
  const boxes = new Map([
    ['frame', { x: 0, y: 0, width: 300, height: 200 }],
    ['child', { x: 50, y: 50, width: 20, height: 20 }],
  ]);
  expect(marqueeSelection(boxes, { x: -1, y: -1 }, { x: 301, y: 201 })).toEqual(
    ['frame', 'child'],
  );
  expect(marqueeSelection(boxes, { x: 40, y: 40 }, { x: 80, y: 80 })).toEqual([
    'child',
  ]);
  expect(marqueeSelection(boxes, { x: 80, y: 80 }, { x: 40, y: 40 })).toEqual([
    'frame',
    'child',
  ]);
});
it('collapse and clipping remove descendants from marquee candidates', () => {
  const d = recursiveFixture();
  expect(sceneBounds(d).objects.has('api')).toBe(true);
  d.rootDepths.app = 0;
  expect(sceneBounds(d).objects.has('api')).toBe(false);
  d.rootDepths.app = 1;
  d.objects.app.style = { clipToFrame: true };
  d.layouts.app[1].api.x = 10000;
  expect(sceneBounds(d).objects.has('api')).toBe(false);
});
