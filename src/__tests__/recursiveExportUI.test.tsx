import { createRef } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type Konva from 'konva';
import RecursiveExport, {
  type RecursiveExportHandle,
} from '../renderer/components/RecursiveExport';
import {
  captureRecursiveScene,
  encodeRecursiveExport,
  restrictExportScene,
} from '../renderer/utils/recursiveExport';
import { recursiveFixture } from './recursiveFixtures';

jest.mock('../renderer/utils/recursiveExport', () => ({
  captureRecursiveScene: jest.fn(),
  encodeRecursiveExport: jest.fn(),
  restrictExportScene: jest.fn(),
}));

function openExport(selection: string[] = []) {
  const clone = {} as Konva.Group;
  const destroy = jest.fn();
  jest.mocked(captureRecursiveScene).mockReturnValue({
    clone: () => clone,
    destroy,
  } as unknown as Konva.Group);
  const ref = createRef<RecursiveExportHandle>();
  const onStatus = jest.fn();
  render(
    <RecursiveExport
      ref={ref}
      stamp="test"
      stage={() => ({}) as Konva.Stage}
      document={recursiveFixture()}
      selection={selection}
      isBusy={() => false}
      onStatus={onStatus}
    />,
  );
  act(() => ref.current!());
  return { clone, destroy, onStatus };
}

beforeEach(() => jest.clearAllMocks());

it.each([
  ['svg', [], 'whole'],
  ['png', ['object-api'], 'selection'],
  ['svg', ['object-api'], 'whole'],
] as const)(
  'exports %s with %j in %s scope',
  async (format, selection, scope) => {
    const data = format === 'svg' ? '<svg />' : new Uint8Array([1, 2]);
    jest.mocked(encodeRecursiveExport).mockResolvedValue(data);
    const exportImage = jest.fn().mockResolvedValue('/exported');
    Object.assign(window, { desktop: { export: { exportImage } } });
    const { clone, destroy, onStatus } = openExport([...selection]);
    const dialog = screen.getByRole('dialog', { name: 'Export image' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('aria-label', 'Export image');
    expect(dialog).toHaveAccessibleDescription(/including offscreen content/);
    const scopeField = screen.queryByRole('combobox', { name: 'Scope' });
    if (selection.length) {
      expect(scopeField).toHaveValue('selection');
      fireEvent.change(scopeField!, { target: { value: scope } });
    } else {
      expect(scopeField).not.toBeInTheDocument();
    }
    fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), {
      target: { value: format },
    });
    expect(
      screen.getByRole('combobox', { name: 'Format' }),
    ).toHaveAccessibleDescription(
      format === 'svg' ? /Stays sharp/ : /Ready to share/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(exportImage).toHaveBeenCalledWith(
        format,
        data,
        `Fixture.${format}`,
      ),
    );
    expect(encodeRecursiveExport).toHaveBeenCalledWith(clone, format);
    expect(restrictExportScene).toHaveBeenCalledTimes(
      scope === 'selection' ? 1 : 0,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(dialog).not.toBeInTheDocument();
    expect(onStatus).toHaveBeenCalledWith(
      `${format.toUpperCase()} exported successfully!`,
    );
  },
);

it.each(['Cancel', 'Close export image', 'Escape'])(
  '%s dismisses without exporting and releases the snapshot',
  (action) => {
    const close = jest
      .spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        // Closing before removal lets the browser restore focus to the opener.
        expect(this.isConnected).toBe(true);
        this.open = false;
      });
    const { destroy } = openExport();
    if (action === 'Escape') {
      fireEvent(
        screen.getByRole('dialog'),
        new Event('cancel', { cancelable: true }),
      );
    } else {
      fireEvent.click(screen.getByRole('button', { name: action }));
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(encodeRecursiveExport).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  },
);
