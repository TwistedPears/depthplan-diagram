import { act, fireEvent, render, screen } from '@testing-library/react';
import RootDepthControls from '../renderer/components/RootDepthControls';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { selectRootDepth } from '../shared/recursiveLayouts';

it('reveals depth on demand and retains a pending edit when the drawer closes', () => {
  const busy = jest.fn();
  const choose = jest.fn();
  render(
    <RootDepthControls
      document={recursiveFixture()}
      onSelect={choose}
      onBusyChange={busy}
    />,
  );
  const drawer = screen.getByLabelText('Root depths');
  const toggle = drawer.querySelector('summary')!;
  expect(drawer).not.toHaveAttribute('open');
  fireEvent.click(toggle);
  const input = screen.getByLabelText('app depth');
  fireEvent.change(input, { target: { value: '2' } });
  expect(busy).toHaveBeenCalledWith('depth-draft:app', true);
  busy.mockClear();
  fireEvent.click(toggle);
  expect(drawer).not.toHaveAttribute('open');
  expect(choose).not.toHaveBeenCalled();
  expect(busy).not.toHaveBeenCalledWith('depth-draft:app', false);
  fireEvent.click(toggle);
  expect(input).toHaveValue(2);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue(1);
  expect(busy).toHaveBeenCalledWith('depth-draft:app', false);
});

it('shows distinct duplicate roots and leaves; applies a single dirty first-use change, restores and undoes it', () => {
  const original = recursiveFixture();
  delete original.layouts.app[2];
  original.objects.payments.name = 'app';
  let state: ReturnType<typeof useDocumentState>;
  function Owner() {
    state = useDocumentState(original);
    return state.document ? (
      <RootDepthControls
        document={state.document}
        onSelect={(id, depth) => state.transact(selectRootDepth(id, depth))}
      />
    ) : null;
  }
  render(<Owner />);
  expect(screen.getByLabelText('app (app) depth')).toHaveValue(1);
  expect(screen.getByLabelText('app (payments) depth')).toHaveValue(0);
  expect(
    screen.getByText('Current D0 / maximum D0 · leaf'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Reveal all for app (payments)' }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText('app (app) depth'), {
    target: { value: '2' },
  });
  expect(state!.past).toHaveLength(0);
  screen.getByLabelText('app (app) depth').focus();
  fireEvent.submit(
    screen.getByRole('form', { name: 'app (app) depth controls' }),
  );
  expect(screen.getByLabelText('app (app) depth')).toHaveFocus();
  expect(state!.past).toHaveLength(1);
  expect(state!.dirty).toBe(true);
  expect(state!.result!.document.rootDepths).toEqual({ app: 2, payments: 0 });
  expect(state!.result!.document.layouts.app[2].endpoint).toEqual(
    original.objects.endpoint.geometry,
  );
  expect(state!.result!.document.layouts.payments).toEqual(
    original.layouts.payments,
  );
  expect(
    screen.getByRole('button', { name: 'Set app (app) depth' }),
  ).toBeDisabled();
  act(() => state!.undo());
  expect(state!.document).toEqual(original);
  expect(screen.getByLabelText('app (app) depth')).toHaveValue(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Reveal all for app (app)' }),
  );
  expect(state!.past).toHaveLength(1);
  expect(state!.result!.document.rootDepths.app).toBe(2);
});
it.each(['', '-1', '3', '1.5'])(
  'keeps invalid depth %s editable/cancellable without mutation',
  (value) => {
    const choose = jest.fn();
    render(
      <RootDepthControls document={recursiveFixture()} onSelect={choose} />,
    );
    const input = screen.getByLabelText('app depth');
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.submit(screen.getByRole('form', { name: 'app depth controls' }));
    expect(choose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue(1);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.submit(screen.getByRole('form', { name: 'app depth controls' }));
    expect(choose).toHaveBeenCalledWith('app', 0);
  },
);
it('updates maximum after structural edits and resolves Reveal all when invoked', () => {
  const d = recursiveFixture(),
    choose = jest.fn();
  const { rerender } = render(
    <RootDepthControls document={d} onSelect={choose} />,
  );
  delete d.objects.endpoint;
  d.rootDepths.app = 0;
  rerender(<RootDepthControls document={{ ...d }} onSelect={choose} />);
  expect(screen.getByText('Current D0 / maximum D1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reveal all for app' }));
  expect(choose).toHaveBeenCalledWith('app', 'all');
});

it('reports pending depth drafts and releases them on cancel and unmount', () => {
  const busy = jest.fn();
  const { unmount } = render(
    <RootDepthControls
      document={recursiveFixture()}
      onSelect={jest.fn()}
      onBusyChange={busy}
    />,
  );
  fireEvent.change(screen.getByLabelText('app depth'), {
    target: { value: '' },
  });
  expect(busy).toHaveBeenCalledWith('depth-draft:app', true);
  fireEvent.keyDown(screen.getByLabelText('app depth'), { key: 'Escape' });
  expect(busy).toHaveBeenCalledWith('depth-draft:app', false);
  fireEvent.change(screen.getByLabelText('app depth'), {
    target: { value: '2' },
  });
  unmount();
  expect(busy).toHaveBeenLastCalledWith('depth-draft:payments', false);
});

it('does not report a UI draft while synchronizing an externally committed depth', () => {
  const busy = jest.fn();
  const original = recursiveFixture();
  const { rerender } = render(
    <RootDepthControls
      document={original}
      onSelect={jest.fn()}
      onBusyChange={busy}
    />,
  );
  busy.mockClear();
  rerender(
    <RootDepthControls
      document={{ ...original, rootDepths: { ...original.rootDepths, app: 0 } }}
      onSelect={jest.fn()}
      onBusyChange={busy}
    />,
  );
  expect(screen.getByLabelText('app depth')).toHaveValue(0);
  expect(busy.mock.calls.some(([, value]) => value === true)).toBe(false);
});

it('can reset local folds even when the root is already at maximum depth', () => {
  const document = recursiveFixture();
  document.rootDepths.app = 2;
  document.extensions = { collapsedObjects: ['api'] };
  const choose = jest.fn();
  render(<RootDepthControls document={document} onSelect={choose} />);
  expect(screen.getByText(/branches hidden locally/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Set app depth' }));
  expect(choose).toHaveBeenCalledWith('app', 2);
  fireEvent.click(screen.getByRole('button', { name: 'Reveal all for app' }));
  expect(choose).toHaveBeenCalledWith('app', 'all');
});
