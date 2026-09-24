import { act, renderHook } from '@testing-library/react';
import useExpansionAnimation from '../renderer/hooks/useExpansionAnimation';
import { recursiveFixture } from './recursiveFixtures';
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
