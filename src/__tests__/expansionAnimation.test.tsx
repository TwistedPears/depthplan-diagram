import { act, renderHook } from '@testing-library/react';
import useExpansionAnimation from '../renderer/hooks/useExpansionAnimation';
import { recursiveFixture } from './recursiveFixtures';
import { recursiveScene } from '../shared/recursiveScene';
import { boundsRemap, transitionRoute } from '../shared/routeTransition';
import {
  transactDocument,
  editActiveGeometry,
} from '../shared/documentTransactions';
import {
  activeGeometry,
  setChildrenExpanded,
} from '../shared/recursiveLayouts';

// Native smoke exercises Konva's real spring easing and attached-arrow paint.
jest.mock('konva', () => ({
  __esModule: true,
  default: {
    Easings: { BackEaseOut: (t: number) => t, EaseOut: (t: number) => t },
  },
}));

const collapsed = () => {
  const document = recursiveFixture();
  document.rootDepths.app = 0;
  return document;
};
const expand = (document: ReturnType<typeof collapsed>) =>
  transactDocument(document, setChildrenExpanded('app', true)).document;
let media: MediaQueryList;

beforeEach(() => {
  jest.useFakeTimers();
  media = Object.assign(new EventTarget(), {
    matches: false,
  }) as MediaQueryList;
  window.matchMedia = jest.fn(() => media);
});
afterEach(() => {
  jest.useRealTimers();
});

it('animates display geometry without changing the committed layout, then lands exactly', () => {
  const document = collapsed();
  const { result, rerender } = renderHook(
    (d) => useExpansionAnimation(d, false),
    {
      initialProps: document,
    },
  );
  expect(result.current.document).toBe(document);
  const opened = expand(document);
  const saved = JSON.stringify(opened);
  rerender(opened);
  expect(activeGeometry(result.current.document, 'app')).toEqual(
    activeGeometry(document, 'app'),
  );
  act(() => jest.advanceTimersByTime(160));
  expect(activeGeometry(result.current.document, 'app').width).toBeGreaterThan(
    100,
  );
  expect(activeGeometry(result.current.document, 'app').width).toBeLessThan(
    activeGeometry(opened, 'app').width,
  );
  expect(JSON.stringify(opened)).toBe(saved);
  act(() => jest.advanceTimersByTime(400));
  expect(result.current.document).toBe(opened);
});

it('reverses from the currently painted position and cancels stale frames', () => {
  const document = collapsed();
  const { result, rerender } = renderHook(
    (d) => useExpansionAnimation(d, false),
    {
      initialProps: document,
    },
  );
  rerender(expand(document));
  act(() => jest.advanceTimersByTime(160));
  const halfway = activeGeometry(result.current.document, 'app');
  rerender(document); // Undo or a rapid collapse during opening.
  expect(activeGeometry(result.current.document, 'app')).toEqual(halfway);
  act(() => jest.advanceTimersByTime(400));
  expect(result.current.document).toBe(document);
});

it('uses committed geometry immediately when an edit interrupts the animation', () => {
  const document = collapsed();
  const { result, rerender, unmount } = renderHook(
    (d) => useExpansionAnimation(d, false),
    {
      initialProps: document,
    },
  );
  const opened = expand(document);
  rerender(opened);
  act(() => jest.advanceTimersByTime(100));
  const edited = transactDocument(
    opened,
    editActiveGeometry('app', { x: 700 }),
  ).document;
  rerender(edited);
  expect(result.current.document).toBe(edited);
  act(() => jest.advanceTimersByTime(400));
  expect(result.current.document).toBe(edited);
  rerender(document);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('skips motion when requested and stops if the preference changes mid-animation', () => {
  const document = collapsed();
  const { result, rerender } = renderHook(
    (d) => useExpansionAnimation(d, false),
    {
      initialProps: document,
    },
  );
  const opened = expand(document);
  rerender(opened);
  act(() => {
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event('change'));
  });
  expect(result.current.document).toBe(opened);
  expect(jest.getTimerCount()).toBe(0);
  rerender(document);
  expect(result.current.document).toBe(document);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not animate a gesture preview or a different document', () => {
  const document = collapsed();
  const { result, rerender } = renderHook(
    ({ d, preview }) => useExpansionAnimation(d, preview),
    { initialProps: { d: document, preview: false } },
  );
  const opened = expand(document);
  rerender({ d: opened, preview: false });
  rerender({ d: opened, preview: true });
  expect(result.current.document).toBe(opened);
  expect(jest.getTimerCount()).toBe(0);
  const other = { ...document, id: 'other' };
  rerender({ d: other, preview: false });
  expect(result.current.document).toBe(other);
});

it('can settle synchronously before capturing an export', () => {
  const document = collapsed();
  const { result, rerender } = renderHook(
    (d) => useExpansionAnimation(d, false),
    {
      initialProps: document,
    },
  );
  const opened = expand(document);
  rerender(opened);
  expect(result.current.document).not.toBe(opened);
  act(() => result.current.finish());
  expect(result.current.document).toBe(opened);
  expect(jest.getTimerCount()).toBe(0);
});

// A shape-avoiding connector between the two roots; `app` moves when it opens.
const linked = () => {
  const document = collapsed();
  document.connections.link = {
    id: 'link',
    ownerId: null,
    kind: 'arrow',
    z: 0,
    start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
    end: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
    style: { lineType: 'elbow', avoidShapes: true },
  };
  return document;
};
const routeOf = (scene: ReturnType<typeof recursiveScene>) =>
  scene.connections.get(null)!.find((route) => route.id === 'link')!;

it('glides shape-avoiding routes to the final layout instead of routing every frame', () => {
  const document = linked();
  const { result, rerender } = renderHook(
    (d) => useExpansionAnimation(d, false),
    { initialProps: document },
  );
  expect(result.current.routes).toBeUndefined();
  const opened = expand(document);
  const start = routeOf(recursiveScene(document));
  const target = routeOf(recursiveScene(opened));
  expect(target.route[0].x).not.toBe(start.route[0].x);
  rerender(opened);
  // The first frame paints the route that was on screen.
  expect(result.current.routes!.get('link')!.route).toEqual(start.route);
  const seen = [start.route[0].x];
  for (let i = 0; i < 6; i++) {
    act(() => jest.advanceTimersByTime(48));
    const frame = result.current.routes!.get('link')!;
    expect(frame.route).toHaveLength(target.route.length);
    expect(frame.points).toEqual(frame.route.flatMap(({ x, y }) => [x, y]));
    // The scene paints the given route as is.
    expect(
      routeOf(recursiveScene(result.current.document, result.current.routes))
        .route,
    ).toEqual(frame.route);
    seen.push(frame.route[0].x);
  }
  // One direction, no flipping between alternatives, and never past the target.
  const direction = Math.sign(target.route[0].x - start.route[0].x);
  for (let i = 1; i < seen.length; i++)
    expect((seen[i] - seen[i - 1]) * direction).toBeGreaterThan(0);
  expect((target.route[0].x - seen.at(-1)!) * direction).toBeGreaterThan(0);
  act(() => jest.advanceTimersByTime(400));
  expect(result.current.document).toBe(opened);
  expect(result.current.routes).toBeUndefined();
  expect(routeOf(recursiveScene(result.current.document)).route).toEqual(
    target.route,
  );
});

it('follows the container when a route has no comparable start', () => {
  const target = routeOf(recursiveScene(expand(linked())));
  const box = { x: 0, y: 0, width: 100, height: 100 };
  // Shapes at 80% of their final layout: the route shrinks with them.
  const remap = boundsRemap([box], [{ x: 0, y: 0, width: 80, height: 80 }]);
  expect(remap({ x: 50, y: -50 })).toEqual({ x: 40, y: -40 });
  const frame = transitionRoute(undefined, target, 0.5, remap);
  expect(frame.route).toEqual(target.route.map(remap));
  expect(frame.label).toEqual(remap(target.label));
  // A start with a different number of bends is not blended point by point.
  const longer = { ...target, route: [...target.route, target.route[0]] };
  expect(transitionRoute(longer, target, 0.5, remap).route).toEqual(
    target.route.map(remap),
  );
  expect(transitionRoute(target, target, 0.5, remap).route).toEqual(
    target.route,
  );
});
