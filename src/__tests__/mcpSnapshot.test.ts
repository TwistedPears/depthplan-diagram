import { useRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { base64, mcpSnapshot } from '../renderer/hooks/mcpSnapshot';
import type { RecursiveExportHandle } from '../renderer/components/RecursiveExport';
import {
  planSnapshot,
  snapshotRegion,
  snapshotScale,
} from '../renderer/utils/snapshotRegion';
import {
  SNAPSHOT_MAX_BASE64,
  snapshotInput,
  snapshotTools,
} from '../shared/mcpSnapshotContract';
import { sceneBounds } from '../shared/recursiveCamera';
import { editNamedView } from '../shared/namedViews';
import { recursiveFixture } from './recursiveFixtures';

const handle = { appInstanceId: 'app', sessionId: 'session' };
const view = (document = recursiveFixture()) => ({
  document,
  camera: { x: -100, y: -50, scale: 2 },
  viewport: { width: 800, height: 600 },
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const parse = (input: object) => snapshotInput.parse({ handle, ...input });

test('the contract is read-only, defaults to a 1.5 MP viewport and caps requests at 4 MP', () => {
  const tool = snapshotTools.depthplan_snapshot;
  expect(tool.readOnly).toBe(true);
  expect(parse({})).toMatchObject({ scope: 'viewport', maxPixels: 1_500_000 });
  expect(
    snapshotInput.safeParse({ handle, maxPixels: 4_000_001 }).success,
  ).toBe(false);
  expect(snapshotInput.safeParse({ handle, scope: 'selection' }).success).toBe(
    false,
  );
  const data = {
    scope: 'whole',
    width: 10,
    height: 10,
    scale: 1,
    region: { x: 0, y: 0, width: 10, height: 10 },
    revision: 0,
    viewRevision: 0,
    bytes: 1,
  };
  expect(tool.output.safeParse({ ok: true, state: null, data }).success).toBe(
    true,
  );
  // The image travels as MCP content, never inside structured metadata.
  expect(
    tool.output.safeParse({
      ok: true,
      state: null,
      data: { ...data, png: 'iVBO' },
    }).success,
  ).toBe(false);
});

test('scopes map to world regions and the scale fits pixel and side caps', () => {
  expect(snapshotRegion(parse({}), view())).toEqual({
    scope: 'viewport',
    region: { x: 50, y: 25, width: 400, height: 300 },
    natural: 2,
  });
  expect(planSnapshot(parse({}), view())).toMatchObject({
    scale: 2,
    width: 800,
    height: 600,
  });
  expect(planSnapshot(parse({ maxPixels: 30_000 }), view())).toMatchObject({
    scale: 0.5,
    width: 200,
    height: 150,
  });
  const bounds = sceneBounds(recursiveFixture());
  const whole = snapshotRegion(parse({ scope: 'whole' }), view());
  expect(whole.region).toEqual({
    x: bounds.bounds!.x - 16,
    y: bounds.bounds!.y - 16,
    width: bounds.bounds!.width + 32,
    height: bounds.bounds!.height + 32,
  });
  const payments = bounds.objects.get('payments')!;
  expect(
    snapshotRegion(parse({ scope: 'objects', ids: ['payments'] }), view())
      .region,
  ).toEqual({
    x: payments.x - 16,
    y: payments.y - 16,
    width: payments.width + 32,
    height: payments.height + 32,
  });
  // whole/objects fill maxPixels, enlarging a small region up to 4x so details
  // are readable; camera views keep the on-screen zoom (asserted above).
  const crop = planSnapshot(
    parse({ scope: 'objects', ids: ['payments'] }),
    view(),
  );
  expect(crop.scale).toBeGreaterThan(1);
  expect(crop.scale).toBeLessThanOrEqual(4);
  expect(crop.width * crop.height).toBeLessThanOrEqual(1_500_000);
  expect(crop.width).toBe(Math.floor(crop.region.width * crop.scale));
  const small = planSnapshot(
    parse({ scope: 'objects', ids: ['payments'], maxPixels: 10_000 }),
    view(),
  );
  expect(small.width * small.height).toBeLessThanOrEqual(10_000);
  expect(planSnapshot(parse({ scope: 'whole' }), view()).scale).toBe(
    Math.min(
      4,
      Math.sqrt(1_500_000 / (whole.region.width * whole.region.height)),
    ),
  );
  // endpoint is hidden at depth 1; objects never reveal hidden content.
  expect(() =>
    snapshotRegion(parse({ scope: 'objects', ids: ['endpoint'] }), view()),
  ).toThrow(/not visible/);
  expect(() => snapshotRegion(parse({ scope: 'objects' }), view())).toThrow(
    /requires ids/,
  );
  expect(() =>
    snapshotRegion(parse({}), { ...view(), viewport: { width: 0, height: 0 } }),
  ).toThrow(/not been measured/);
  const long = snapshotScale(
    { x: 0, y: 0, width: 100_000, height: 10 },
    1,
    4e6,
  );
  expect(long.width).toBeLessThanOrEqual(4096);
  expect(long.height).toBe(1);
  for (const maxPixels of [10_000, 1_500_000, 4_000_000]) {
    const fit = snapshotScale(
      { x: 0, y: 0, width: 9000, height: 7000 },
      1,
      maxPixels,
    );
    expect(fit.width * fit.height).toBeLessThanOrEqual(maxPixels);
  }
});

test('bookmarks render their camera view only when their depth state matches', () => {
  const live = view();
  const document = clone(live.document);
  const bookmarkCamera = { x: -10, y: -20, scale: 0.5 };
  editNamedView(
    { type: 'create', id: 'overview', name: 'Overview' },
    bookmarkCamera,
    live.viewport,
  )(document);
  expect(
    snapshotRegion(parse({ bookmarkId: 'overview' }), { ...live, document }),
  ).toEqual({
    scope: 'bookmark',
    region: { x: 20, y: 40, width: 1600, height: 1200 },
    natural: 0.5,
  });
  const deeper = clone(document);
  deeper.rootDepths.app = 2;
  expect(() =>
    snapshotRegion(parse({ bookmarkId: 'overview' }), {
      ...live,
      document: deeper,
    }),
  ).toThrow(/Apply it with depthplan_bookmarks first/);
  expect(() => snapshotRegion(parse({ bookmarkId: 'missing' }), live)).toThrow(
    /not found/,
  );
});

function setup() {
  return renderHook(() => {
    const owner = useDocumentState(recursiveFixture(), 'app');
    const exportRef = useRef<RecursiveExportHandle>(null);
    return { owner, exportRef };
  });
}
test('the handler renders the planned region inline and leaves the board untouched', async () => {
  const { result } = setup();
  act(() =>
    result.current.owner.setCanvas((canvas) => ({
      ...canvas,
      selected: ['object-app'],
      viewport: { width: 400, height: 300 },
    })),
  );
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  type Request = Parameters<RecursiveExportHandle['snapshot']>[0];
  // The canvas reports ink beyond document frames (e.g. overflowing text).
  const render = jest.fn(async (request: Request) => ({
    png,
    plan: request.refit({ x: -500, y: -40, width: 40, height: 20 }),
  }));
  result.current.exportRef.current = Object.assign(() => {}, {
    capture: jest.fn(),
    snapshot: render,
  });
  let busy = false,
    active = true;
  const handler = mcpSnapshot(() => ({
    snapshot: result.current.owner.snapshot,
    isBusy: () => busy,
    exportRef: result.current.exportRef,
    isActive: () => active,
  }));
  const before = result.current.owner.snapshot();
  const own = { appInstanceId: 'app', sessionId: before.sessionId };
  const reply: any = await act(() =>
    handler({ handle: own, scope: 'whole', maxPixels: 10_000 }),
  );
  expect(reply.ok).toBe(true);
  expect(reply.data).toMatchObject({
    scope: 'whole',
    revision: before.revision,
    viewRevision: before.viewRevision,
    bytes: png.length,
    png: base64(png),
  });
  expect(reply.data.width * reply.data.height).toBeLessThanOrEqual(10_000);
  const planned = render.mock.calls[0][0].plan;
  expect(reply.data.region.x).toBe(-516);
  expect(reply.data.region.x).toBeLessThan(planned.region.x);
  expect(reply.data.region.x + reply.data.region.width).toBe(
    planned.region.x + planned.region.width,
  );
  const after = result.current.owner.snapshot();
  expect(after.revision).toBe(before.revision);
  expect(after.viewRevision).toBe(before.viewRevision);
  expect(after.camera).toEqual(before.camera);
  expect(after.canvas.selected).toEqual(['object-app']);
  expect(after.canUndo).toBe(before.canUndo);
  expect(after.document).toBe(before.document);
  expect(after.dirty).toBe(false);

  const code = async (input: object) =>
    ((await act(() => handler({ handle: own, ...input }))) as any).error?.code;
  expect(await code({ handle: { ...own, sessionId: 'replaced' } })).toBe(
    'STALE_SESSION',
  );
  busy = true;
  expect(await code({})).toBe('BUSY');
  busy = false;
  active = false;
  expect(await code({})).toBe('BUSY');
  active = true;
  render.mockImplementationOnce(async (request) => ({
    png: new Uint8Array(Math.ceil((SNAPSHOT_MAX_BASE64 * 3) / 4) + 3),
    plan: request.plan,
  }));
  expect(await code({})).toBe('RESPONSE_TOO_LARGE');
  render.mockImplementationOnce(async (request) => {
    act(() => result.current.owner.setCamera({ x: 5, y: 0, scale: 1 }));
    return { png, plan: request.plan };
  });
  expect(await code({})).toBe('STALE_REVISION');
  render.mockRejectedValueOnce(
    new Error('Canvas has not rendered the requested revision'),
  );
  const own2 = {
    appInstanceId: 'app',
    sessionId: result.current.owner.snapshot().sessionId,
  };
  expect(((await act(() => handler({ handle: own2 }))) as any).error.code).toBe(
    'BUSY',
  );
  expect(render).toHaveBeenCalledTimes(4);
});
