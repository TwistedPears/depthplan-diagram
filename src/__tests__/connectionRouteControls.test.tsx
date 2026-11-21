import { act, fireEvent, render, screen } from '@testing-library/react';
import SelectionProperties from '../renderer/components/SelectionProperties';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import type { RecursiveDocument } from '../shared/recursiveDocument';

it('switches avoid-shapes routing and a per-depth route from Style', () => {
  const document = recursiveFixture();
  document.connections.wire = {
    id: 'wire',
    kind: 'arrow',
    ownerId: 'app',
    z: 0,
    start: { kind: 'object', objectId: 'api', side: 'right', offset: 0.5 },
    end: { kind: 'free', x: 300, y: 0 },
    points: [{ x: 200, y: 0 }],
    style: { lineType: 'elbow' },
  };
  let state: ReturnType<typeof useDocumentState>;
  let current: RecursiveDocument;
  function Editor() {
    state = useDocumentState(document);
    if (!state.document) return null;
    current = state.document;
    return (
      <SelectionProperties
        document={current}
        selection={['connection-wire']}
        textMode={false}
        onEdit={state.transact}
      />
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Own route at D1' }));
  expect(current!.connections.wire.depthRoutes).toEqual({
    1: {
      start: document.connections.wire.start,
      end: document.connections.wire.end,
      points: [{ x: 200, y: 0 }],
    },
  });
  expect(
    screen.getByRole('button', { name: 'Own route at D1' }),
  ).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(
    screen.getByRole('button', { name: 'Same route at every depth' }),
  );
  expect(current!.connections.wire.depthRoutes).toBeUndefined();

  fireEvent.click(
    screen.getByRole('button', { name: 'Elbow path around shapes' }),
  );
  expect(current!.connections.wire.style).toEqual({
    lineType: 'elbow',
    avoidShapes: true,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Elbow path' }));
  expect(current!.connections.wire.style).toEqual({
    lineType: 'elbow',
    avoidShapes: false,
  });
  act(() => state!.undo());
  expect(current!.connections.wire.style?.avoidShapes).toBe(true);
});
