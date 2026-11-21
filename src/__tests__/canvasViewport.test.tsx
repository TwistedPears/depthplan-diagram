import { Activity, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RecursiveCanvas from '../renderer/components/RecursiveCanvas';
import NamedViews from '../renderer/components/NamedViews';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';

jest.mock('react-konva', () => {
  const Node = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Stage: ({
      width,
      height,
      x,
      y,
      scaleX,
      children,
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <div
        data-testid="stage"
        data-size={`${String(width)}x${String(height)}`}
        data-camera={`${String(x)},${String(y)},${String(scaleX)}`}
      >
        {children}
      </div>
    ),
    Layer: Node,
    Group: Node,
    Rect: Node,
    Circle: Node,
    Ellipse: Node,
    Line: Node,
    Arrow: Node,
    Text: Node,
    Path: Node,
  };
});
jest.mock('konva', () => ({
  __esModule: true,
  default: {
    Easings: { BackEaseOut: (t: number) => t, EaseOut: (t: number) => t },
  },
}));
jest.mock('../renderer/components/ChildStackToggle', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../renderer/components/RecursiveScene', () => ({
  __esModule: true,
  default: () => null,
}));

let owner: ReturnType<typeof useDocumentState>;
let show: (active: boolean) => void;
function Board() {
  const [active, setActive] = useState(true);
  show = setActive;
  owner = useDocumentState(recursiveFixture(), 'app');
  return (
    <Activity mode={active ? 'visible' : 'hidden'}>
      <RecursiveCanvas
        active={active}
        document={owner.document!}
        hasHistory={false}
        stamp="test"
        fitRef={owner.fitCanvas}
        focusRef={owner.focusCanvas}
        canvas={owner.canvas}
        setCanvas={owner.setCanvas}
        camera={owner.camera}
        setCamera={owner.setCamera}
        onEdit={owner.transact}
        onSelectDepth={owner.selectDepth}
        onBusyChange={owner.setBusy}
        exportRef={{ current: null }}
        isBusy={owner.isBusy}
        onStatus={() => {}}
        onSaveTemplate={() => {}}
      />
      <NamedViews
        document={owner.document!}
        onCommand={owner.changeNamedView}
        isBusy={owner.isBusy}
        onBusy={owner.setBusy}
        onStatus={() => {}}
      />
    </Activity>
  );
}
const resize = (width: number, height: number) =>
  act(() => {
    Object.assign(window, { innerWidth: width, innerHeight: height });
    window.dispatchEvent(new Event('resize'));
  });

beforeEach(() => {
  Object.assign(window, { innerWidth: 1024, innerHeight: 696 });
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  window.matchMedia = jest.fn(
    () => Object.assign(new EventTarget(), { matches: true }) as MediaQueryList,
  );
});

it('remeasures a board resized while hidden and applies its bookmark at the real center', () => {
  render(<Board />);
  act(() => owner.setCamera({ x: -200, y: -100, scale: 0.5 }));
  act(() => {
    owner.changeNamedView({ type: 'create', id: 'view', name: 'View' });
  });
  // The view was captured centered at 1024×696: focus (1424, 896).
  expect(owner.document!.namedViews!.view.cameraFocus).toEqual({
    x: 1424,
    y: 896,
  });
  act(() => show(false));
  resize(3440, 1297);
  act(() => show(true));
  expect(owner.canvas.viewport).toEqual({ width: 3440, height: 1297 });
  expect(screen.getByTestId('stage')).toHaveAttribute('data-size', '3440x1297');
  act(() => owner.setCamera({ x: 0, y: 0, scale: 1 }));
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  expect(owner.camera).toEqual({
    x: 3440 / 2 - 1424 * 0.5,
    y: 1297 / 2 - 896 * 0.5,
    scale: 0.5,
  });
  expect(screen.getByTestId('stage')).toHaveAttribute(
    'data-camera',
    `${owner.camera.x},${owner.camera.y},0.5`,
  );
});

it('applies MCP-created bookmarks from the panel exactly as MCP apply does', () => {
  render(<Board />);
  const call = (kind: 'edit' | 'bookmarks', extra: Record<string, unknown>) => {
    const s = owner.snapshot();
    let result!: { ok: boolean };
    act(() => {
      result = owner.editorCommand(kind, {
        handle: { appInstanceId: s.appInstanceId, sessionId: s.sessionId },
        expectedRevision: s.revision,
        expectedViewRevision: s.viewRevision,
        requestId: crypto.randomUUID(),
        ...extra,
      });
    });
    expect(result.ok).toBe(true);
  };
  const bookmark = (id: string, depth: number, x: number) =>
    call('edit', {
      camera: { x, y: -40, scale: 0.8 },
      actions: [
        { type: 'depth', rootId: 'app', depth },
        { type: 'bookmark', action: { type: 'create', id, name: id } },
      ],
    });
  bookmark('Overview', 0, 100);
  bookmark('Detail', 2, -300);
  resize(3440, 1297);
  const views = owner.document!.namedViews!;
  const stage = () => screen.getByTestId('stage').getAttribute('data-camera');
  const results: unknown[] = [];
  for (const id of ['Overview', 'Detail', 'Overview']) {
    fireEvent.click(screen.getByRole('button', { name: id }));
    const panel = {
      depth: owner.document!.rootDepths.app,
      camera: owner.camera,
    };
    expect(panel.depth).toBe(views[id].rootDepths.app);
    expect(panel.camera).toEqual({
      x: 1720 - views[id].cameraFocus!.x * 0.8,
      y: 648.5 - views[id].cameraFocus!.y * 0.8,
      scale: 0.8,
    });
    expect(stage()).toBe(`${panel.camera.x},${panel.camera.y},0.8`);
    act(() => owner.setCamera({ x: 0, y: 0, scale: 1 }));
    call('bookmarks', { action: { type: 'apply', id } });
    results.push(panel, {
      depth: owner.document!.rootDepths.app,
      camera: owner.camera,
    });
  }
  for (let at = 0; at < results.length; at += 2)
    expect(results[at + 1]).toEqual(results[at]);
});
