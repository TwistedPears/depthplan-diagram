import { act, fireEvent, render, screen, within } from '@testing-library/react';
import NamedViews from '../renderer/components/NamedViews';
import RecoveryChoices from '../renderer/components/RecoveryChoices';
import { recursiveFixture } from './recursiveFixtures';
import type { RecoveryCandidate } from '../shared/recoveryContract';

beforeAll(() => {
  HTMLElement.prototype.showPopover = jest.fn();
  HTMLElement.prototype.hidePopover = jest.fn();
});

it('renames a bookmark with focused text, validation, inline errors and cancellation', () => {
  const document = recursiveFixture();
  document.namedViews = {
    overview: { id: 'overview', name: 'Overview', rootDepths: {} },
  };
  const onCommand = jest.fn().mockReturnValue({
    status: 'accepted',
    adjustments: [],
  });
  const onBusy = jest.fn();
  render(
    <NamedViews
      document={document}
      onCommand={onCommand}
      isBusy={() => false}
      onBusy={onBusy}
      onStatus={() => {}}
    />,
  );
  const openRename = () => {
    const summary = screen.getByText('Bookmarks').closest('summary')!;
    summary.closest('details')!.open = true;
    fireEvent.keyDown(screen.getByRole('button', { name: 'Overview' }), {
      key: 'F10',
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    return screen.getByRole('dialog', { name: 'Rename bookmark' });
  };
  const dialog = openRename();
  const input = within(dialog).getByRole('textbox', { name: 'Bookmark name' });
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Overview');
  expect(onBusy).toHaveBeenLastCalledWith('bookmark-name', true);
  fireEvent.change(input, { target: { value: '  ' } });
  expect(screen.getByRole('button', { name: 'Save bookmark' })).toBeDisabled();
  fireEvent.submit(input.closest('form')!);
  expect(onCommand).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'System overview' } });
  onCommand.mockReturnValueOnce({
    status: 'rejected',
    error: 'Bookmark no longer exists.',
    adjustments: [],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Bookmark no longer exists.',
  );
  expect(onBusy).toHaveBeenLastCalledWith('bookmark-name', true);
  fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
  expect(onCommand).toHaveBeenLastCalledWith({
    type: 'rename',
    id: 'overview',
    name: 'System overview',
  });
  expect(dialog).not.toBeInTheDocument();
  expect(onBusy).toHaveBeenLastCalledWith('bookmark-name', false);
  const reopened = openRename();
  fireEvent(reopened, new Event('cancel', { cancelable: true }));
  expect(reopened).not.toBeInTheDocument();
  expect(onCommand).toHaveBeenCalledTimes(2);
});

it('blocks recovery dismissal while preparing and reopens if restoration is canceled', async () => {
  let finish!: (candidate: RecoveryCandidate) => void;
  const candidate: RecoveryCandidate = {
    document: recursiveFixture(),
    source: null,
    sessionId: 'recovered',
  };
  const release = jest.fn().mockResolvedValue(undefined);
  Object.assign(window, {
    desktop: {
      recovery: {
        discover: jest.fn().mockResolvedValue({
          entries: [
            {
              id: 'recovery',
              title: 'Recovered diagram',
              sourcePath: null,
              capturedAt: '2026-09-25T12:00:00Z',
              sessionId: 'recovered',
              instanceId: 'app',
              revision: 2,
            },
          ],
          warnings: [],
        }),
        prepare: jest.fn(
          () =>
            new Promise<RecoveryCandidate>((resolve) => {
              finish = resolve;
            }),
        ),
        release,
      },
    },
  });
  const onRestore = jest.fn().mockResolvedValue(false);
  render(<RecoveryChoices onRestore={onRestore} />);
  const dialog = await screen.findByRole('dialog', {
    name: 'Recover unsaved work',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  expect(
    screen.getByRole('button', { name: 'Continue without restoring' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Close recover unsaved work' }),
  ).toBeDisabled();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(dialog).toBeInTheDocument();
  await act(async () => finish(candidate));
  expect(onRestore).toHaveBeenCalledWith(candidate);
  expect(release).toHaveBeenCalledWith('recovery');
  expect(
    screen.getByRole('dialog', { name: 'Recover unsaved work' }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue without restoring' }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
